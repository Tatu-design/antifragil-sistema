import { redirect } from "next/navigation";

import { haySesion } from "@/lib/auth";

export default async function Inicio() {
  redirect((await haySesion()) ? "/clientes" : "/login");
}
