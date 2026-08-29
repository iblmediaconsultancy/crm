"use client";

import Add from "@carbon/icons-react/es/Add";
import Close from "@carbon/icons-react/es/Close";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { CURRENCIES, normalizeCurrency } from "@crm/db/currency";
import type { FieldValueJson } from "@crm/db/fields";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AgentPanel } from "@/components/crm/agent-panel";
import { contactName } from "@/components/crm/contact-name";
import { FieldsCog, RecordFields } from "@/components/crm/fields/record-fields";
import {
	InlineDateField,
	InlineField,
	InlineSelectField,
	InlineTextArea,
	InlineTextCell,
	savingValue,
} from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { DealStageMenu } from "@/components/crm/stage-change";
import { StageStepper } from "@/components/crm/stage-stepper";
import { Timeline } from "@/components/crm/timeline/timeline";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetProperties,
	DetailSheetProperty,
	DetailSheetSection,
	DetailSheetStat,
	DetailSheetStats,
	type DetailSheetTab,
} from "@/components/detail-sheet";
import {
	LocalDateTime,
	LocalDay,
	LocalRelativeTime,
} from "@/components/local-date-time";
import { savingField } from "@/lib/pending-field";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { AttachDealContact } from "./quick-add";
import { RecordActions } from "./record-actions";
import { AddRow, RecordSheetFrame } from "./record-parts";
import { useOpenRecord, useRecordSheetView } from "./record-stack";

type Deal = RouterOutputs["deals"]["byId"];

const CURRENCY_OPTIONS = CURRENCIES.map((entry) => ({
	value: entry.code,
	label: `${entry.code} · ${entry.name}`,
}));

function dealCurrency(currency: string) {
	return normalizeCurrency(currency) || currency;
}

function currencyOptions(currency: string) {
	if (CURRENCY_OPTIONS.some((option) => option.value === currency)) {
		return CURRENCY_OPTIONS;
	}

	return [
		{ value: currency, label: `${currency} — no longer supported` },
		...CURRENCY_OPTIONS,
	];
}

function ReportedValue({ deal }: { deal: Deal }) {
	const currency = dealCurrency(deal.currency);

	if (currency === deal.reportingCurrency) return null;
	if (deal.amountCents === null) return null;

	return (
		<DetailSheetProperty label={`In ${deal.reportingCurrency}`}>
			{deal.baseAmountCents === null ? (
				<span className="text-muted-foreground">
					No {currency} rate — left out of totals
				</span>
			) : (
				<span className="tabular-nums text-muted-foreground">
					≈ {formatMoney(deal.baseAmountCents, deal.reportingCurrency)}
				</span>
			)}
		</DetailSheetProperty>
	);
}

const CONTACT_COLUMNS = [
	{ id: "name", header: "Name", width: "w-[28%]", className: "pl-5" },
	{ id: "role", header: "Role", width: "w-[20%]" },
	{ id: "title", header: "Title", width: "w-[22%]" },
	{ id: "email", header: "Email", width: "w-[22%]" },
	{ id: "remove", srLabel: "Remove", width: "w-10" },
];

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
};

export function DealSheet({ dealId }: { dealId: string }) {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const {
		tab,
		setTab,
		form: adding,
		setForm: setAdding,
	} = useRecordSheetView("overview");

	const query = useQuery(trpc.deals.byId.queryOptions({ id: dealId }));
	const deal = query.data;

	const tabs: DetailSheetTab[] = deal
		? [
				{
					value: "overview",
					label: "Overview",
					content: <DealOverview deal={deal} />,
				},
				{
					value: "contacts",
					label: "Contacts",
					count: deal.contacts.length,
					content: (
						<DealContacts
							deal={deal}
							adding={adding === "contact"}
							onAdd={() => setAdding("contact")}
							onDone={() => setAdding(null)}
						/>
					),
				},
				{
					value: "finance",
					label: "Finance",
					content: <DealFinance dealId={deal.id} />,
				},
				{
					value: "activity",
					label: "Activity",
					content: <Timeline anchor={{ dealId: deal.id }} />,
				},
				{
					value: "agent",
					label: "Agent",
					content: <AgentPanel record={{ kind: "deal", id: deal.id }} />,
					keepMounted: true,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={deal?.name ?? "Deal"}
			description={
				deal ? (
					<button
						type="button"
						onClick={() => openRecord({ kind: "company", id: deal.company.id })}
						className="text-foreground underline-offset-2 hover:underline"
					>
						{deal.company.name}
					</button>
				) : undefined
			}
			media={
				deal ? (
					<EntityLogo
						src={deal.company.iconUrl}
						darkSrc={deal.company.iconDarkUrl}
						tone={deal.company.iconTone as EntityLogoTone | null | undefined}
						name={deal.company.name}
						size="lg"
					/>
				) : null
			}
			actions={
				deal ? (
					<>
						<DealStageMenu
							dealId={deal.id}
							stage={deal.stage}
							variant="control"
						/>
						<RecordActions
							record={{ kind: "deal", id: deal.id }}
							name={deal.name}
							version={deal.version}
							lifecycleState={deal.lifecycleState}
						/>
					</>
				) : null
			}
			stats={
				deal ? (
					<DetailSheetStats>
						<DetailSheetStat label="Amount">
							{deal.amountCents === null ? (
								<EmptyCellValue />
							) : (
								<span className="tabular-nums">
									{formatMoney(deal.amountCents, dealCurrency(deal.currency))}
								</span>
							)}
						</DetailSheetStat>
						<DetailSheetStat label="Expected close">
							{deal.expectedCloseDate ? (
								<LocalDay date={deal.expectedCloseDate} />
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetStat>
						<DetailSheetStat label="In stage">
							<LocalRelativeTime date={deal.stageChangedAt} />
						</DetailSheetStat>
						<DetailSheetStat label="Owner">
							<OwnerCell owner={deal.owner} />
						</DetailSheetStat>
					</DetailSheetStats>
				) : null
			}
			tabs={tabs}
			tab={tab}
			onTabChange={setTab}
		/>
	);
}

function DealOverview({ deal }: { deal: Deal }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const update = useMutation(
		trpc.deals.update.mutationOptions({
			onSuccess: () => cache.deal(deal.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const saveFields = (fields: Record<string, FieldValueJson>) =>
		update.mutate({ id: deal.id, data: { fields } });

	const isSavingField = savingValue(update);

	const save = (data: Parameters<typeof update.mutate>[0]["data"]) =>
		update.mutate({ id: deal.id, data });

	const currency = dealCurrency(deal.currency);

	const isSaving = savingField(update);

	return (
		<DetailSheetBody>
			<DetailSheetSection title="Stage">
				<StageStepper dealId={deal.id} stage={deal.stage} />

				{deal.closedReason ? (
					<DetailSheetProperties>
						<DetailSheetProperty label="Closed">
							{deal.closedAt ? (
								<LocalDateTime date={deal.closedAt} options={DATE_OPTIONS} />
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetProperty>
						<DetailSheetProperty label="Reason" wide>
							{deal.closedReason}
						</DetailSheetProperty>
					</DetailSheetProperties>
				) : null}
			</DetailSheetSection>

			<DetailSheetSection title="Details" action={<FieldsCog kind="deal" />}>
				<DetailSheetProperties>
					<InlineField
						label="Name"
						value={deal.name}
						saving={isSaving("name")}
						onSave={(name) => name && save({ name })}
					/>
					<InlineField
						label="Amount"
						value={
							deal.amountCents === null ? null : String(deal.amountCents / 100)
						}
						placeholder="24000"
						saving={isSaving("amountCents")}
						onSave={(next) => {
							if (next === "") return save({ amountCents: null });
							const parsed = Number.parseFloat(next);
							if (!Number.isFinite(parsed) || parsed < 0) {
								toast.error("Amount has to be a number.");
								return;
							}
							save({ amountCents: Math.round(parsed * 100) });
						}}
						render={(value) =>
							formatMoney(Math.round(Number(value) * 100), currency)
						}
					/>
					<InlineField
						label="Proposed package"
						value={deal.potentialPackageName ?? null}
						placeholder="Monthly representation"
						saving={isSaving("potentialPackageName")}
						onSave={(next) =>
							save({ potentialPackageName: next.trim() || null })
						}
					/>
					<InlineField
						label="Potential monthly MRR"
						value={
							deal.potentialMonthlyRevenueCents === null
								? null
								: String(deal.potentialMonthlyRevenueCents / 100)
						}
						placeholder="1000"
						saving={isSaving("potentialMonthlyRevenueCents")}
						onSave={(next) => {
							if (next === "")
								return save({ potentialMonthlyRevenueCents: null });
							const parsed = Number.parseFloat(next);
							if (!Number.isFinite(parsed) || parsed < 0)
								return toast.error(
									"Potential MRR has to be a positive number.",
								);
							save({ potentialMonthlyRevenueCents: Math.round(parsed * 100) });
						}}
						render={(value) =>
							formatMoney(Math.round(Number(value) * 100), currency)
						}
					/>
					<InlineField
						label="Potential one-off revenue"
						value={
							deal.potentialOneOffRevenueCents === null
								? null
								: String(deal.potentialOneOffRevenueCents / 100)
						}
						placeholder="0"
						saving={isSaving("potentialOneOffRevenueCents")}
						onSave={(next) => {
							if (next === "")
								return save({ potentialOneOffRevenueCents: null });
							const parsed = Number.parseFloat(next);
							if (!Number.isFinite(parsed) || parsed < 0)
								return toast.error(
									"Potential one-off revenue has to be a positive number.",
								);
							save({ potentialOneOffRevenueCents: Math.round(parsed * 100) });
						}}
						render={(value) =>
							formatMoney(Math.round(Number(value) * 100), currency)
						}
					/>
					<InlineSelectField
						label="Currency"
						value={currency}
						options={currencyOptions(currency)}
						onSave={(currency) => save({ currency })}
					/>
					<ReportedValue deal={deal} />
					<InlineDateField
						label="Close date"
						value={deal.expectedCloseDate}
						saving={isSaving("expectedCloseDate")}
						onSave={(next) => save({ expectedCloseDate: next || null })}
					/>
					<InlineSelectField
						label="Company"
						value={deal.company.id}
						options={(companies.data ?? []).map((company) => ({
							value: company.id,
							label: company.name,
						}))}
						onSave={(companyId) => save({ companyId })}
					/>
					<InlineSelectField
						label="Owner"
						value={deal.owner.id}
						options={(users.data ?? []).map((user) => ({
							value: user.id,
							label: user.name,
						}))}
						onSave={(ownerId) => save({ ownerId })}
					/>
					<RecordFields
						fields={deal.fields}
						saving={isSavingField}
						onSave={saveFields}
					/>
				</DetailSheetProperties>
			</DetailSheetSection>

			<DetailSheetSection title="Description">
				<InlineTextArea
					label="Description"
					value={deal.description}
					placeholder={`What ${deal.company.name} is buying, why now, and what stands in the way.`}
					saving={isSaving("description")}
					onSave={(description) => save({ description })}
				/>
			</DetailSheetSection>

			<WhereItStands deal={deal} />
		</DetailSheetBody>
	);
}

function DealFinance({ dealId }: { dealId: string }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const profile = useQuery(trpc.finance.profile.queryOptions({ dealId }));
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const data = profile.data;

	if (profile.isPending)
		return (
			<DetailSheetBody>
				<DetailSheetSection title="Financial profile">
					Loading financial details…
				</DetailSheetSection>
			</DetailSheetBody>
		);
	if (!data)
		return (
			<DetailSheetBody>
				{workspace.data?.viewerRole === "admin" ? (
					<DealFinanceEditor
						dealId={dealId}
						profile={null}
						onSaved={() => cache.finance()}
					/>
				) : (
					<DetailSheetSection title="Financial profile">
						<p className="text-muted-foreground text-sm">
							No financial profile has been recorded for this relationship.
						</p>
					</DetailSheetSection>
				)}
			</DetailSheetBody>
		);

	const money = (value: number | null) =>
		value === null ? (
			<EmptyCellValue />
		) : (
			<span className="tabular-nums">{formatMoney(value, data.currency)}</span>
		);
	return (
		<DetailSheetBody>
			{workspace.data?.viewerRole === "admin" ? (
				<DealFinanceEditor
					dealId={dealId}
					profile={data}
					onSaved={() => cache.finance()}
				/>
			) : null}
			<DetailSheetSection title="Financial profile">
				<DetailSheetProperties>
					<DetailSheetProperty label="Package">
						{data.packageName ?? <EmptyCellValue />}
					</DetailSheetProperty>
					<DetailSheetProperty label="Billing">
						{data.billingStatus.replaceAll("_", " ")}
					</DetailSheetProperty>
					<DetailSheetProperty label="Monthly fee">
						{money(data.monthlyFeeCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Outstanding">
						{money(data.outstandingAmountCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Direct recurring cost">
						{money(data.directMonthlyCostCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Editor cost">
						{money(data.editorMonthlyCostCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Other recurring cost">
						{money(data.otherRecurringCostCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Onboarding fee">
						{money(data.onboardingFeeCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="One-off work">
						{money(data.oneOffRevenueCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Additional charges">
						{money(data.additionalChargesCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Commissions" wide>
						{data.commissions.length ? (
							<div className="grid gap-1">
								{data.commissions.map((commission) => (
									<div key={commission.id} className="flex flex-wrap gap-x-2">
										<span>{commission.userName}</span>
										<span className="text-muted-foreground">
											{commission.type === "PERCENTAGE"
												? `${commission.percentage ?? 0}%`
												: commission.fixedAmountCents === null
													? "Fixed amount not available"
													: formatMoney(
															commission.fixedAmountCents,
															commission.currency,
														)}{" "}
											{commission.recurring ? "recurring" : "one-off"}
										</span>
									</div>
								))}
							</div>
						) : (
							<EmptyCellValue />
						)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Estimated monthly profit">
						{money(data.estimatedMonthlyProfitCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Estimated margin">
						{data.estimatedMargin === null ? (
							<EmptyCellValue />
						) : (
							`${Math.round(data.estimatedMargin * 100)}%`
						)}
					</DetailSheetProperty>
				</DetailSheetProperties>
			</DetailSheetSection>
		</DetailSheetBody>
	);
}

function DealFinanceEditor({
	dealId,
	profile,
	onSaved,
}: {
	dealId: string;
	profile: NonNullable<RouterOutputs["finance"]["profile"]> | null;
	onSaved: () => Promise<void>;
}) {
	const trpc = useTRPC();
	const [billingStatus, setBillingStatus] = useState(
		profile?.billingStatus ?? "NOT_STARTED",
	);
	const [paymentStatus, setPaymentStatus] = useState(
		profile?.paymentStatus ?? "NOT_APPLICABLE",
	);
	const [commissionUserId, setCommissionUserId] = useState("");
	const [commissionType, setCommissionType] = useState("PERCENTAGE");
	const [commissionValue, setCommissionValue] = useState("");
	const [commissionRecurring, setCommissionRecurring] = useState("true");
	const save = useMutation(trpc.finance.upsertProfile.mutationOptions());
	const saveCommission = useMutation(
		trpc.finance.upsertCommission.mutationOptions(),
	);
	const users = useQuery(trpc.users.list.queryOptions());
	const amount = (value: number | null) =>
		value === null ? "" : String(value / 100);
	const parse = (value: FormDataEntryValue | null) => {
		const text = String(value ?? "").trim();
		if (!text) return null;
		const number = Number.parseFloat(text);
		return Number.isFinite(number) ? Math.round(number * 100) : null;
	};
	const parseDate = (value: FormDataEntryValue | null) => {
		const text = String(value ?? "").trim();
		return text ? new Date(`${text}T00:00:00.000Z`).toISOString() : null;
	};
	return (
		<DetailSheetSection title="Update financial profile">
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					const input = {
						id: profile?.id,
						dealId,
						packageName: String(form.get("packageName") ?? "").trim() || null,
						currency: profile?.currency ?? "EUR",
						billingStatus: billingStatus as
							| "NOT_STARTED"
							| "ACTIVE"
							| "PAUSED"
							| "ENDED",
						paymentStatus: paymentStatus as
							| "NOT_APPLICABLE"
							| "CURRENT"
							| "PENDING"
							| "OVERDUE"
							| "PAID",
						monthlyFeeCents: parse(form.get("monthlyFee")),
						directMonthlyCostCents: parse(form.get("directMonthlyCost")),
						editorMonthlyCostCents: parse(form.get("editorMonthlyCost")),
						otherRecurringCostCents: parse(form.get("otherRecurringCost")),
						onboardingFeeCents: parse(form.get("onboardingFee")),
						oneOffRevenueCents: parse(form.get("oneOffRevenue")),
						additionalChargesCents: parse(form.get("additionalCharges")),
						outstandingAmountCents: parse(form.get("outstandingAmount")),
						contractStartDate: parseDate(form.get("contractStartDate")),
						contractEndDate: parseDate(form.get("contractEndDate")),
					};
					void save
						.mutateAsync(input)
						.then(onSaved)
						.then(() => toast.success("Financial profile saved."))
						.catch((error: Error) => toast.error(error.message));
				}}
			>
				<Field>
					<FieldLabel htmlFor={`${dealId}-package`}>Package</FieldLabel>
					<Input
						id={`${dealId}-package`}
						name="packageName"
						defaultValue={profile?.packageName ?? ""}
						placeholder="Monthly representation"
					/>
				</Field>
				<div className="grid gap-3 sm:grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${dealId}-fee`}>Monthly fee</FieldLabel>
						<Input
							id={`${dealId}-fee`}
							name="monthlyFee"
							defaultValue={amount(profile?.monthlyFeeCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-direct`}>
							Direct monthly cost
						</FieldLabel>
						<Input
							id={`${dealId}-direct`}
							name="directMonthlyCost"
							defaultValue={amount(profile?.directMonthlyCostCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-editor`}>
							Editor monthly cost
						</FieldLabel>
						<Input
							id={`${dealId}-editor`}
							name="editorMonthlyCost"
							defaultValue={amount(profile?.editorMonthlyCostCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-oneoff`}>
							One-off revenue
						</FieldLabel>
						<Input
							id={`${dealId}-oneoff`}
							name="oneOffRevenue"
							defaultValue={amount(profile?.oneOffRevenueCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-other-cost`}>
							Other recurring cost
						</FieldLabel>
						<Input
							id={`${dealId}-other-cost`}
							name="otherRecurringCost"
							defaultValue={amount(profile?.otherRecurringCostCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-onboarding`}>
							Onboarding fee
						</FieldLabel>
						<Input
							id={`${dealId}-onboarding`}
							name="onboardingFee"
							defaultValue={amount(profile?.onboardingFeeCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-charges`}>
							Additional charges
						</FieldLabel>
						<Input
							id={`${dealId}-charges`}
							name="additionalCharges"
							defaultValue={amount(profile?.additionalChargesCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-outstanding`}>
							Outstanding amount
						</FieldLabel>
						<Input
							id={`${dealId}-outstanding`}
							name="outstandingAmount"
							defaultValue={amount(profile?.outstandingAmountCents ?? null)}
							inputMode="decimal"
							placeholder="0"
						/>
					</Field>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${dealId}-contract-start`}>
							Contract start
						</FieldLabel>
						<Input
							id={`${dealId}-contract-start`}
							name="contractStartDate"
							type="date"
							defaultValue={profile?.contractStartDate?.slice(0, 10) ?? ""}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-contract-end`}>
							Contract end
						</FieldLabel>
						<Input
							id={`${dealId}-contract-end`}
							name="contractEndDate"
							type="date"
							defaultValue={profile?.contractEndDate?.slice(0, 10) ?? ""}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-billing`}>
							Billing status
						</FieldLabel>
						<select
							id={`${dealId}-billing`}
							value={billingStatus}
							onChange={(event) => setBillingStatus(event.target.value)}
							className="h-9 rounded-md border bg-background px-3 text-sm"
						>
							<option value="NOT_STARTED">Not started</option>
							<option value="ACTIVE">Active</option>
							<option value="PAUSED">Paused</option>
							<option value="ENDED">Ended</option>
						</select>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${dealId}-payment`}>
							Payment status
						</FieldLabel>
						<select
							id={`${dealId}-payment`}
							value={paymentStatus}
							onChange={(event) => setPaymentStatus(event.target.value)}
							className="h-9 rounded-md border bg-background px-3 text-sm"
						>
							<option value="NOT_APPLICABLE">Not applicable</option>
							<option value="CURRENT">Current</option>
							<option value="PENDING">Pending</option>
							<option value="OVERDUE">Overdue</option>
							<option value="PAID">Paid</option>
						</select>
					</Field>
				</div>
				<Button type="submit" disabled={save.isPending}>
					{save.isPending ? "Saving…" : "Save financial profile"}
				</Button>
			</form>
			{profile ? (
				<div className="mt-4 grid gap-3">
					<div className="font-medium text-sm">Commissions</div>
					{profile.commissions.length ? (
						<div className="grid gap-1 text-sm">
							{profile.commissions.map((commission) => (
								<div
									key={commission.id}
									className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"
								>
									<span>{commission.userName}</span>
									<span className="flex items-center gap-2">
										{commission.type === "PERCENTAGE"
											? `${commission.percentage ?? 0}%`
											: commission.fixedAmountCents === null
												? "Fixed amount unavailable"
												: formatMoney(
														commission.fixedAmountCents,
														commission.currency,
													)}{" "}
										{commission.recurring ? "recurring" : "one-off"}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={saveCommission.isPending}
											onClick={() => {
												void saveCommission
													.mutateAsync({
														id: commission.id,
														financialProfileId: profile.id,
														userId: commission.userId,
														type: commission.type as "PERCENTAGE" | "FIXED",
														recurring: commission.recurring,
														percentage: commission.percentage,
														fixedAmountCents: commission.fixedAmountCents,
														currency: commission.currency,
														active: !commission.active,
													})
													.then(onSaved)
													.catch((error: Error) => toast.error(error.message));
											}}
										>
											{commission.active ? "Deactivate" : "Activate"}
										</Button>
									</span>
								</div>
							))}
						</div>
					) : null}
					<form
						className="grid gap-3 sm:grid-cols-2"
						onSubmit={(event) => {
							event.preventDefault();
							const value = Number.parseFloat(commissionValue);
							if (!commissionUserId || !Number.isFinite(value) || value < 0) {
								toast.error("Choose a user and enter a commission value.");
								return;
							}
							void saveCommission
								.mutateAsync({
									financialProfileId: profile.id,
									userId: commissionUserId,
									type: commissionType as "PERCENTAGE" | "FIXED",
									recurring: commissionRecurring === "true",
									percentage: commissionType === "PERCENTAGE" ? value : null,
									fixedAmountCents:
										commissionType === "FIXED" ? Math.round(value * 100) : null,
									currency: profile.currency,
									active: true,
								})
								.then(onSaved)
								.then(() => {
									setCommissionUserId("");
									setCommissionValue("");
									toast.success("Commission saved.");
								})
								.catch((error: Error) => toast.error(error.message));
						}}
					>
						<Field>
							<FieldLabel htmlFor={`${dealId}-commission-user`}>
								User
							</FieldLabel>
							<select
								id={`${dealId}-commission-user`}
								className="h-9 rounded-md border bg-background px-3 text-sm"
								value={commissionUserId}
								onChange={(event) => setCommissionUserId(event.target.value)}
							>
								<option value="">Choose a user</option>
								{(users.data ?? []).map((user) => (
									<option key={user.id} value={user.id}>
										{user.name}
									</option>
								))}
							</select>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${dealId}-commission-type`}>
								Type
							</FieldLabel>
							<select
								id={`${dealId}-commission-type`}
								className="h-9 rounded-md border bg-background px-3 text-sm"
								value={commissionType}
								onChange={(event) => setCommissionType(event.target.value)}
							>
								<option value="PERCENTAGE">Percentage</option>
								<option value="FIXED">Fixed amount</option>
							</select>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${dealId}-commission-value`}>
								{commissionType === "PERCENTAGE" ? "Percentage" : "Amount"}
							</FieldLabel>
							<Input
								id={`${dealId}-commission-value`}
								value={commissionValue}
								inputMode="decimal"
								placeholder="10"
								onChange={(event) => setCommissionValue(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${dealId}-commission-frequency`}>
								Frequency
							</FieldLabel>
							<select
								id={`${dealId}-commission-frequency`}
								className="h-9 rounded-md border bg-background px-3 text-sm"
								value={commissionRecurring}
								onChange={(event) => setCommissionRecurring(event.target.value)}
							>
								<option value="true">Recurring</option>
								<option value="false">One-off</option>
							</select>
						</Field>
						<Button type="submit" disabled={saveCommission.isPending}>
							{saveCommission.isPending ? "Saving…" : "Add commission"}
						</Button>
					</form>
				</div>
			) : null}
		</DetailSheetSection>
	);
}

function WhereItStands({ deal }: { deal: Deal }) {
	const openRecord = useOpenRecord();

	return (
		<DetailSheetSection title="Where it stands">
			<DetailSheetProperties>
				<DetailSheetProperty label="Opened">
					<LocalDateTime date={deal.createdAt} options={DATE_OPTIONS} />
				</DetailSheetProperty>

				<DetailSheetProperty label="In stage since">
					<LocalDateTime date={deal.stageChangedAt} options={DATE_OPTIONS} />
				</DetailSheetProperty>

				{deal.closedAt ? (
					<DetailSheetProperty label="Closed">
						<LocalDateTime date={deal.closedAt} options={DATE_OPTIONS} />
					</DetailSheetProperty>
				) : null}

				{deal.closedReason ? (
					<DetailSheetProperty label="Reason" wide>
						{deal.closedReason}
					</DetailSheetProperty>
				) : null}

				<DetailSheetProperty label="On it" wide>
					{deal.contacts.length === 0 ? (
						<span className="text-muted-foreground">
							Nobody from {deal.company.name} is attached yet.
						</span>
					) : (
						<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
							{deal.contacts.map((contact) => {
								const aside = contact.role ?? contact.title;
								return (
									<button
										key={contact.id}
										type="button"
										onClick={() =>
											openRecord({ kind: "contact", id: contact.id })
										}
										className="min-w-0 truncate underline-offset-2 hover:underline"
									>
										{contactName(contact)}
										{aside ? (
											<span className="text-muted-foreground"> ({aside})</span>
										) : null}
									</button>
								);
							})}
						</span>
					)}
				</DetailSheetProperty>
			</DetailSheetProperties>
		</DetailSheetSection>
	);
}

function DealContacts({
	deal,
	adding,
	onAdd,
	onDone,
}: {
	deal: Deal;
	adding: boolean;
	onAdd: () => void;
	onDone: () => void;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const openRecord = useOpenRecord();

	const detach = useMutation(
		trpc.deals.detachContact.mutationOptions({
			onSuccess: () => cache.deal(deal.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setRole = useMutation(
		trpc.deals.setContactRole.mutationOptions({
			onSuccess: () => cache.deal(deal.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const form = adding ? (
		<AttachDealContact
			dealId={deal.id}
			companyName={deal.company.name}
			onDone={onDone}
		/>
	) : null;

	if (deal.contacts.length === 0) {
		return (
			<>
				{form}
				{adding ? null : (
					<DetailSheetEmpty
						icon={UserMultiple}
						title="No contacts on this deal"
						description={`Nobody from ${deal.company.name} is attached yet. Bring the people you are selling to onto the deal and it says who to chase.`}
						action={
							<Button variant="outline" size="sm" onClick={onAdd}>
								<Icon icon={Add} data-icon="inline-start" />
								Add contact
							</Button>
						}
					/>
				)}
			</>
		);
	}

	return (
		<>
			{form}
			<SimpleTable variant="panel" columns={CONTACT_COLUMNS}>
				{deal.contacts.map((contact) => (
					<SimpleTableRow
						key={contact.id}
						clickable
						onClick={() => openRecord({ kind: "contact", id: contact.id })}
					>
						<TableCell className="truncate py-2.5 pr-3 pl-5 font-medium">
							<span className="flex min-w-0 items-center gap-2">
								<PersonAvatar
									src={contact.imageUrl}
									name={contactName(contact)}
									email={contact.email}
									size="sm"
								/>
								<span className="truncate">{contactName(contact)}</span>
							</span>
						</TableCell>
						<TableCell className="truncate px-1 py-2.5">
							<InlineTextCell
								label={`Role on this deal for ${contactName(contact)}`}
								value={contact.role}
								placeholder="Champion"
								saving={
									setRole.isPending &&
									setRole.variables?.contactId === contact.id
								}
								onSave={(role) =>
									setRole.mutate({
										dealId: deal.id,
										contactId: contact.id,
										role: role || null,
									})
								}
							/>
						</TableCell>
						<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
							{contact.title ?? <EmptyCellValue />}
						</TableCell>
						<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
							{contact.email ?? <EmptyCellValue />}
						</TableCell>
						<TableCell className="px-3 py-2.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon-xs"
										disabled={detach.isPending}
										onClick={(event) => {
											event.stopPropagation();
											detach.mutate({
												dealId: deal.id,
												contactId: contact.id,
											});
										}}
									>
										<Icon icon={Close} />
										<span className="sr-only">
											Take {contactName(contact)} off this deal
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>Take off this deal</TooltipContent>
							</Tooltip>
						</TableCell>
					</SimpleTableRow>
				))}

				<AddRow
					label="Add contact"
					columns={CONTACT_COLUMNS.length}
					onClick={onAdd}
				/>
			</SimpleTable>
		</>
	);
}
