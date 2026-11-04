import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "organizer" | "bidder" | "auditor";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", u.user.id).single(),
      supabase.from("user_roles").select("role").eq("user_id", u.user.id),
    ]);
    return {
      id: u.user.id,
      email: u.user.email ?? "",
      profile,
      roles: (roles ?? []).map((r) => r.role as Role),
    };
  },
});

export function useMe() {
  return useQuery(meQuery);
}

export const roleLabel: Record<Role, string> = {
  organizer: "Organizador",
  bidder: "Participante",
  auditor: "Auditor",
};
