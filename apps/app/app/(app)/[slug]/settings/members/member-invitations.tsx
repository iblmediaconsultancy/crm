"use client";
import { Button } from "@crm/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@crm/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";

const selectClass = "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function MemberInvitations() {
	const trpc = useTRPC(); const queryClient = useQueryClient();
	const pending = useQuery(trpc.onboarding.pending.queryOptions({ take: 50 }));
	const refresh = async () => { await queryClient.invalidateQueries({ queryKey: trpc.onboarding.pending.queryKey() }); };
	const invite = useMutation(trpc.onboarding.invite.mutationOptions({ onSuccess: async () => { toast.success("Invitation queued."); await refresh(); }, onError: (error) => toast.error(error.message) }));
	const resend = useMutation(trpc.onboarding.resend.mutationOptions({ onSuccess: async () => { toast.success("A fresh invitation was queued."); await refresh(); }, onError: (error) => toast.error(error.message) }));
	const cancel = useMutation(trpc.onboarding.cancel.mutationOptions({ onSuccess: async () => { toast.success("Invitation cancelled."); await refresh(); }, onError: (error) => toast.error(error.message) }));
	return <Card><CardHeader><CardTitle>Invite a team member</CardTitle><CardDescription className="block">Public signup is disabled. Invitations create no account until accepted.</CardDescription></CardHeader><CardContent className="grid gap-6"><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); invite.mutate({ email: String(form.get("email")), role: String(form.get("role")) as "team" | "contributor", expiresInDays: 7 }); }}><FieldGroup className="sm:grid sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"><Field><FieldLabel>Email</FieldLabel><Input type="email" name="email" required /></Field><Field><FieldLabel>Role</FieldLabel><select className={selectClass} name="role"><option value="contributor">Contributor</option><option value="team">Team</option></select></Field><Button type="submit" disabled={invite.isPending}>Queue invitation</Button></FieldGroup></form><div className="grid gap-2"><h3 className="font-medium text-sm">Pending invitations</h3>{pending.data?.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3"><div className="min-w-0 flex-1"><p className="truncate font-medium text-sm">{row.email}</p><p className="text-muted-foreground text-xs">{row.role} · expires <LocalRelativeTime date={row.expiresAt} /></p></div><Button size="sm" variant="outline" onClick={() => resend.mutate({ invitationId: row.id })}>Resend</Button><Button size="sm" variant="ghost" onClick={() => cancel.mutate({ invitationId: row.id })}>Cancel</Button></div>)}<p className="hidden only:block text-muted-foreground text-sm">No pending invitations.</p></div></CardContent></Card>;
}