"use client";

import {
	FINANCE_PERMISSIONS,
	type FinancePermission,
} from "@crm/auth/permissions";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function FinanceSettings() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const expenses = useQuery(trpc.finance.expenses.queryOptions({}));
	const goals = useQuery(trpc.finance.goals.queryOptions());
	const currency = useQuery(trpc.currency.settings.queryOptions());
	const members = useQuery(
		trpc.workspace.members.queryOptions({
			q: "",
			sort: "name",
			dir: "asc",
			page: 1,
			pageSize: 100,
			role: "all",
		}),
	);
	const overrides = useQuery(trpc.finance.permissionOverrides.queryOptions());
	const categoryId = useId();
	const expenseAmountId = useId();
	const expenseStartId = useId();
	const expenseEndId = useId();
	const expenseDescriptionId = useId();
	const goalNameId = useId();
	const goalAmountId = useId();
	const goalDeadlineId = useId();
	const goalMilestonesId = useId();
	const [category, setCategory] = useState("");
	const [expenseAmount, setExpenseAmount] = useState("");
	const [expenseStart, setExpenseStart] = useState("");
	const [expenseEnd, setExpenseEnd] = useState("");
	const [expenseDescription, setExpenseDescription] = useState("");
	const [expenseRecurring, setExpenseRecurring] = useState("true");
	const [expenseActive, setExpenseActive] = useState(true);
	const [editingExpenseId, setEditingExpenseId] = useState<
		string | undefined
	>();
	const [goalName, setGoalName] = useState("");
	const [goalAmount, setGoalAmount] = useState("");
	const [goalDeadline, setGoalDeadline] = useState("");
	const [goalMilestones, setGoalMilestones] = useState("");
	const [editingGoalId, setEditingGoalId] = useState<string | undefined>();
	const [permissionUserId, setPermissionUserId] = useState("");
	const [permission, setPermission] = useState<FinancePermission>(
		"finance.company.mrr",
	);
	const [permissionAllowed, setPermissionAllowed] = useState("true");
	const [targetUserId, setTargetUserId] = useState("");
	const [targetWeekStart, setTargetWeekStart] = useState("");
	const [targetOutreach, setTargetOutreach] = useState("0");
	const [targetFollowUps, setTargetFollowUps] = useState("0");
	const [targetQualified, setTargetQualified] = useState("0");
	const [targetProposals, setTargetProposals] = useState("0");
	const [targetClosed, setTargetClosed] = useState("0");
	const [targetMrr, setTargetMrr] = useState("");

	const saveExpense = useMutation(trpc.finance.upsertExpense.mutationOptions());
	const saveGoal = useMutation(trpc.finance.upsertGoal.mutationOptions());
	const savePermission = useMutation(
		trpc.finance.setPermissionOverride.mutationOptions(),
	);
	const saveTarget = useMutation(
		trpc.finance.upsertWeeklyTarget.mutationOptions(),
	);
	const financePermissions = FINANCE_PERMISSIONS;
	const parseMilestones = (value: string) => {
		if (!value.trim()) return [];
		const milestones = value.split(",").map((entry) => {
			const [date, amount] = entry.split(":").map((part) => part.trim());
			const parsedAmount = Number.parseFloat(amount ?? "");
			const parsedDate = new Date(`${date}T00:00:00.000Z`);
			if (
				!date ||
				!Number.isFinite(parsedAmount) ||
				Number.isNaN(parsedDate.getTime())
			)
				return null;
			return {
				date: parsedDate.toISOString(),
				targetAmountCents: Math.round(parsedAmount * 100),
			};
		});
		const validMilestones = milestones.filter(
			(milestone): milestone is NonNullable<typeof milestone> =>
				milestone !== null,
		);
		return validMilestones.length === milestones.length
			? validMilestones
			: null;
	};

	return (
		<div className="grid max-w-4xl gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Operating expenses</CardTitle>
					<CardDescription>
						Track recurring and one-off company costs used in estimated profit.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<form
						className="grid gap-3 sm:grid-cols-3"
						onSubmit={(event) => {
							event.preventDefault();
							const amount = Number.parseFloat(expenseAmount);
							if (
								!category.trim() ||
								!Number.isFinite(amount) ||
								!expenseStart
							) {
								toast.error("Add a category, amount and start date.");
								return;
							}
							void saveExpense
								.mutateAsync({
									category,
									amountCents: Math.round(amount * 100),
									currency: currency.data?.reportingCurrency ?? "EUR",
									recurringMonthly: expenseRecurring === "true",
									active: expenseActive,
									id: editingExpenseId,
									startDate: new Date(
										`${expenseStart}T00:00:00.000Z`,
									).toISOString(),
									endDate: expenseEnd
										? new Date(`${expenseEnd}T00:00:00.000Z`).toISOString()
										: null,
									description: expenseDescription.trim() || null,
								})
								.then(async () => {
									await cache.finance();
									setCategory("");
									setExpenseAmount("");
									setExpenseStart("");
									setExpenseEnd("");
									setExpenseDescription("");
									setExpenseActive(true);
									setEditingExpenseId(undefined);
									toast.success("Expense saved.");
								})
								.catch((error: Error) => toast.error(error.message));
						}}
					>
						<Field>
							<FieldLabel htmlFor={categoryId}>Category</FieldLabel>
							<Input
								id={categoryId}
								value={category}
								placeholder="Software"
								onChange={(event) => setCategory(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={expenseAmountId}>
								{expenseRecurring === "true" ? "Monthly amount" : "Amount"}
							</FieldLabel>
							<Input
								id={expenseAmountId}
								inputMode="decimal"
								value={expenseAmount}
								placeholder="250"
								onChange={(event) => setExpenseAmount(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={expenseStartId}>Start date</FieldLabel>
							<Input
								id={expenseStartId}
								type="date"
								value={expenseStart}
								onChange={(event) => setExpenseStart(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="expense-frequency">Frequency</FieldLabel>
							<select
								id="expense-frequency"
								className="h-9 w-full rounded-md border bg-background px-3 text-sm"
								value={expenseRecurring}
								onChange={(event) => setExpenseRecurring(event.target.value)}
							>
								<option value="true">Recurring monthly</option>
								<option value="false">One-off</option>
							</select>
						</Field>
						<Field>
							<FieldLabel htmlFor={expenseEndId}>End date</FieldLabel>
							<Input
								id={expenseEndId}
								type="date"
								value={expenseEnd}
								onChange={(event) => setExpenseEnd(event.target.value)}
							/>
						</Field>
						<Field className="sm:col-span-3">
							<FieldLabel htmlFor={expenseDescriptionId}>
								Description
							</FieldLabel>
							<Textarea
								id={expenseDescriptionId}
								value={expenseDescription}
								placeholder="Optional context for the expense"
								onChange={(event) => setExpenseDescription(event.target.value)}
							/>
						</Field>
						<Button
							type="submit"
							disabled={saveExpense.isPending}
							className="sm:col-span-3"
						>
							{saveExpense.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{editingExpenseId ? "Update expense" : "Save expense"}
						</Button>
						{editingExpenseId ? (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setEditingExpenseId(undefined);
									setCategory("");
									setExpenseAmount("");
									setExpenseStart("");
									setExpenseEnd("");
									setExpenseDescription("");
									setExpenseRecurring("true");
									setExpenseActive(true);
								}}
							>
								Cancel edit
							</Button>
						) : null}
					</form>
					<div className="grid gap-2">
						{expenses.data?.map((expense) => (
							<div
								key={expense.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
							>
								<span>
									<strong className="font-medium">{expense.category}</strong>
									<span className="ml-2 text-muted-foreground">
										{expense.recurringMonthly ? "Monthly" : "One-off"} · Since{" "}
										{new Date(expense.startDate).toLocaleDateString()}
									</span>
								</span>
								<span className="flex items-center gap-3">
									<span className="tabular-nums">
										{(expense.amountCents / 100).toLocaleString(undefined, {
											style: "currency",
											currency: expense.currency,
										})}
									</span>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => {
											setEditingExpenseId(expense.id);
											setCategory(expense.category);
											setExpenseAmount(String(expense.amountCents / 100));
											setExpenseStart(expense.startDate.slice(0, 10));
											setExpenseEnd(expense.endDate?.slice(0, 10) ?? "");
											setExpenseDescription(expense.description ?? "");
											setExpenseRecurring(String(expense.recurringMonthly));
											setExpenseActive(expense.active);
										}}
									>
										Edit
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={saveExpense.isPending}
										onClick={() => {
											void saveExpense
												.mutateAsync({
													id: expense.id,
													category: expense.category,
													amountCents: expense.amountCents,
													currency: expense.currency,
													recurringMonthly: expense.recurringMonthly,
													active: !expense.active,
													startDate: expense.startDate,
													endDate: expense.endDate,
													description: expense.description,
												})
												.then(() => cache.finance())
												.catch((error: Error) => toast.error(error.message));
										}}
									>
										{expense.active ? "Deactivate" : "Activate"}
									</Button>
								</span>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>MRR goal</CardTitle>
					<CardDescription>
						Set the target and deadline shown in the Command Center.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3 sm:grid-cols-3"
						onSubmit={(event) => {
							event.preventDefault();
							const amount = Number.parseFloat(goalAmount);
							const milestones = parseMilestones(goalMilestones);
							if (
								!goalName.trim() ||
								!Number.isFinite(amount) ||
								!goalDeadline ||
								milestones === null
							) {
								toast.error(
									"Add a goal name, target and deadline. Milestones use date:amount pairs.",
								);
								return;
							}
							void saveGoal
								.mutateAsync({
									id: editingGoalId,
									name: goalName,
									targetAmountCents: Math.round(amount * 100),
									deadline: new Date(
										`${goalDeadline}T00:00:00.000Z`,
									).toISOString(),
									milestones,
									active: true,
								})
								.then(async () => {
									await cache.finance();
									setEditingGoalId(undefined);
									setGoalName("");
									setGoalAmount("");
									setGoalDeadline("");
									setGoalMilestones("");
									toast.success("MRR goal saved.");
								})
								.catch((error: Error) => toast.error(error.message));
						}}
					>
						<Field>
							<FieldLabel htmlFor={goalNameId}>Goal name</FieldLabel>
							<Input
								id={goalNameId}
								value={goalName}
								placeholder="MRR target"
								onChange={(event) => setGoalName(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={goalAmountId}>Target MRR</FieldLabel>
							<Input
								id={goalAmountId}
								inputMode="decimal"
								value={goalAmount}
								placeholder="10000"
								onChange={(event) => setGoalAmount(event.target.value)}
							/>
							<FieldDescription>
								Reported in{" "}
								{currency.data?.reportingCurrency ?? "the workspace currency"}.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={goalDeadlineId}>Deadline</FieldLabel>
							<Input
								id={goalDeadlineId}
								type="date"
								value={goalDeadline}
								onChange={(event) => setGoalDeadline(event.target.value)}
							/>
						</Field>
						<Field className="sm:col-span-3">
							<FieldLabel htmlFor={goalMilestonesId}>
								Monthly milestones
							</FieldLabel>
							<Textarea
								id={goalMilestonesId}
								value={goalMilestones}
								placeholder="2026-09-30:2500, 2026-10-31:5000"
								onChange={(event) => setGoalMilestones(event.target.value)}
							/>
							<FieldDescription>
								Use date:amount pairs in the reporting currency, separated by
								commas.
							</FieldDescription>
						</Field>
						<Button
							type="submit"
							disabled={saveGoal.isPending}
							className="sm:col-span-3"
						>
							{saveGoal.isPending ? <Spinner data-icon="inline-start" /> : null}
							{editingGoalId ? "Update MRR goal" : "Save MRR goal"}
						</Button>
						{editingGoalId ? (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setEditingGoalId(undefined);
									setGoalName("");
									setGoalAmount("");
									setGoalDeadline("");
									setGoalMilestones("");
								}}
							>
								Cancel edit
							</Button>
						) : null}
					</form>
					<div className="mt-4 grid gap-2">
						{goals.data?.map((goal) => (
							<div
								key={goal.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
							>
								<span>
									<strong className="font-medium">{goal.name}</strong>
									<span className="ml-2 text-muted-foreground">
										By {new Date(goal.deadline).toLocaleDateString()}
									</span>
								</span>
								<span className="flex items-center gap-3">
									<span className="tabular-nums">
										{(goal.targetAmountCents / 100).toLocaleString(undefined, {
											style: "currency",
											currency: goal.currency,
										})}
									</span>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => {
											setEditingGoalId(goal.id);
											setGoalName(goal.name);
											setGoalAmount(String(goal.targetAmountCents / 100));
											setGoalDeadline(goal.deadline.slice(0, 10));
											setGoalMilestones(
												goal.milestones
													.map(
														(milestone) =>
															`${milestone.date.slice(0, 10)}:${milestone.targetAmountCents / 100}`,
													)
													.join(", "),
											);
										}}
									>
										Edit
									</Button>
								</span>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Financial permissions</CardTitle>
					<CardDescription>
						Override the default Team and Contributor finance access per member.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<form
						className="grid gap-3 sm:grid-cols-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!permissionUserId) {
								toast.error("Choose a member.");
								return;
							}
							void savePermission
								.mutateAsync({
									userId: permissionUserId,
									permission,
									allowed: permissionAllowed === "true",
								})
								.then(async () => {
									await cache.finance();
									await cache.workspace();
									toast.success("Financial permission saved.");
								})
								.catch((error: Error) => toast.error(error.message));
						}}
					>
						<Field>
							<FieldLabel htmlFor="permission-member">Member</FieldLabel>
							<select
								id="permission-member"
								className="h-9 w-full rounded-md border bg-background px-3 text-sm"
								value={permissionUserId}
								onChange={(event) => setPermissionUserId(event.target.value)}
							>
								<option value="">Choose a member</option>
								{members.data?.rows.map((member) => (
									<option key={member.userId} value={member.userId}>
										{member.name} · {member.role}
									</option>
								))}
							</select>
						</Field>
						<Field>
							<FieldLabel htmlFor="permission-name">Permission</FieldLabel>
							<select
								id="permission-name"
								className="h-9 w-full rounded-md border bg-background px-3 text-sm"
								value={permission}
								onChange={(event) =>
									setPermission(event.target.value as FinancePermission)
								}
							>
								{financePermissions.map((value) => (
									<option key={value} value={value}>
										{value}
									</option>
								))}
							</select>
						</Field>
						<Field>
							<FieldLabel htmlFor="permission-allowed">Access</FieldLabel>
							<select
								id="permission-allowed"
								className="h-9 w-full rounded-md border bg-background px-3 text-sm"
								value={permissionAllowed}
								onChange={(event) => setPermissionAllowed(event.target.value)}
							>
								<option value="true">Allowed</option>
								<option value="false">Hidden or blocked</option>
							</select>
						</Field>
						<Button
							type="submit"
							disabled={savePermission.isPending}
							className="sm:col-span-3"
						>
							{savePermission.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							Save permission
						</Button>
					</form>
					<div className="grid gap-2">
						{overrides.data?.map((override) => (
							<div
								key={override.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
							>
								<span>
									<strong className="font-medium">{override.user.name}</strong>
									<span className="ml-2 text-muted-foreground">
										{override.permission}
									</span>
								</span>
								<span>{override.allowed ? "Allowed" : "Blocked"}</span>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Weekly targets</CardTitle>
					<CardDescription>
						Assign a small set of measurable targets for the current work week.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3 sm:grid-cols-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!targetUserId || !targetWeekStart) {
								toast.error("Choose a member and week.");
								return;
							}
							const number = (value: string) => Number.parseInt(value, 10) || 0;
							const mrr = targetMrr.trim()
								? Math.round(Number.parseFloat(targetMrr) * 100)
								: null;
							void saveTarget
								.mutateAsync({
									userId: targetUserId,
									weekStart: new Date(
										`${targetWeekStart}T00:00:00.000Z`,
									).toISOString(),
									outreachContacts: number(targetOutreach),
									followUps: number(targetFollowUps),
									qualifiedOpportunities: number(targetQualified),
									proposals: number(targetProposals),
									clientsClosed: number(targetClosed),
									mrrGeneratedTargetCents: mrr,
								})
								.then(async () => {
									await cache.finance();
									toast.success("Weekly targets saved.");
								})
								.catch((error: Error) => toast.error(error.message));
						}}
					>
						<Field>
							<FieldLabel htmlFor="target-member">Member</FieldLabel>
							<select
								id="target-member"
								className="h-9 w-full rounded-md border bg-background px-3 text-sm"
								value={targetUserId}
								onChange={(event) => setTargetUserId(event.target.value)}
							>
								<option value="">Choose a member</option>
								{members.data?.rows.map((member) => (
									<option key={member.userId} value={member.userId}>
										{member.name} · {member.role}
									</option>
								))}
							</select>
						</Field>
						<Field>
							<FieldLabel htmlFor="target-week">Week starting</FieldLabel>
							<Input
								id="target-week"
								type="date"
								value={targetWeekStart}
								onChange={(event) => setTargetWeekStart(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="target-mrr">MRR generated</FieldLabel>
							<Input
								id="target-mrr"
								inputMode="decimal"
								value={targetMrr}
								placeholder="1000"
								onChange={(event) => setTargetMrr(event.target.value)}
							/>
						</Field>
						{[
							[
								"target-outreach",
								"Outreach contacts",
								targetOutreach,
								setTargetOutreach,
							],
							[
								"target-follow-ups",
								"Follow-ups",
								targetFollowUps,
								setTargetFollowUps,
							],
							[
								"target-qualified",
								"Qualified opportunities",
								targetQualified,
								setTargetQualified,
							],
							[
								"target-proposals",
								"Proposals",
								targetProposals,
								setTargetProposals,
							],
							[
								"target-closed",
								"Clients closed",
								targetClosed,
								setTargetClosed,
							],
						].map(([id, label, value, setValue]) => (
							<Field key={id as string}>
								<FieldLabel htmlFor={id as string}>
									{label as string}
								</FieldLabel>
								<Input
									id={id as string}
									inputMode="numeric"
									value={value as string}
									onChange={(event) =>
										(setValue as (value: string) => void)(event.target.value)
									}
								/>
							</Field>
						))}
						<Button
							type="submit"
							disabled={saveTarget.isPending}
							className="sm:col-span-3"
						>
							{saveTarget.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							Save weekly targets
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
