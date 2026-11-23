"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/views/components/Icon";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      className="botao fantasma grande so-icone"
      aria-label="Sair"
      title="Sair"
      onClick={logout}
    >
      <Icon name="sair" />
    </button>
  );
}
