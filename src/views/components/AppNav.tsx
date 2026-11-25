"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { BrandMark } from "@/views/components/BrandMark";
import { Icon, type IconName } from "@/views/components/Icon";
import { LogoutButton } from "@/views/components/LogoutButton";
import { initials } from "@/views/lib/initials";

interface NavLink {
  href: string;
  label: string;
  icon: IconName;
}

const MAIN: NavLink[] = [
  { href: "/dashboard", label: "Início", icon: "inicio" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/clientes", label: "Clientes", icon: "pasta" },
  { href: "/faturas", label: "Faturas", icon: "documento" },
  { href: "/integracoes", label: "Integrações", icon: "ligacao" },
];

const ADMIN: NavLink[] = [
  { href: "/admin/utilizadores", label: "Utilizadores", icon: "pessoas" },
  { href: "/admin/conhecimento", label: "Base de conhecimento", icon: "livro" },
  { href: "/admin/whatsapp", label: "WhatsApp", icon: "telemovel" },
];

/** A navegação de quem entrou: as páginas à esquerda (em cima, num telemóvel), a página aberta acesa. */
export function AppNav({ user }: { user: { name: string; role: "ADMIN" | "USER" } }) {
  const pathname = usePathname();
  const links = useRef<HTMLDivElement>(null);

  // Num telemóvel os links deslizam de lado: a página aberta fica à vista.
  useEffect(() => {
    links.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  const current = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`) ? ("page" as const) : undefined;

  const item = (link: NavLink) => (
    <Link key={link.href} className="nav-item" href={link.href} aria-current={current(link.href)}>
      <Icon name={link.icon} />
      {link.label}
    </Link>
  );

  return (
    <nav className="nav" aria-label="Principal">
      <Link className="marca" href="/dashboard" aria-label="ElevateOne Automações, início">
        <BrandMark />
        <span className="marca-textos">
          <span className="marca-nome">ElevateOne</span>
          <span className="marca-modulo">Automações</span>
        </span>
      </Link>

      <div className="nav-links" ref={links}>
        {MAIN.map(item)}
        {user.role === "ADMIN" && (
          <>
            <p className="rotulo nav-grupo">Administração</p>
            {ADMIN.map(item)}
          </>
        )}
      </div>

      <div className="nav-pe">
        <Link className="quem" href="/conta" title="A minha conta" aria-current={current("/conta")}>
          <span className="avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span className="quem-textos">
            <span className="quem-nome">{user.name}</span>
            <span className="quem-papel">
              {user.role === "ADMIN" ? "Administrador" : "Utilizador"}
            </span>
          </span>
        </Link>
        <LogoutButton />
      </div>
    </nav>
  );
}
