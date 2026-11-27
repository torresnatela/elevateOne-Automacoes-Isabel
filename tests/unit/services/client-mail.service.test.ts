import type { InvoiceRecord } from "@/server/models/client-mail.model";
import { invoicesToCsv } from "@/server/services/client-mail.service";

it("invoicesToCsv usa «;» e vírgula decimal, e protege os campos com «;»", () => {
  const csv = invoicesToCsv([
    {
      clientName: "Alfa; Lda",
      status: "A_REVER",
      docType: "FT",
      number: "FT 1",
      atcud: null,
      issueDate: "2026-11-02",
      issuerName: "F",
      issuerNif: "500000000",
      buyerName: null,
      buyerNif: null,
      netTotal: 100,
      vatTotal: 23,
      total: 123.5,
      currency: "EUR",
      fileName: "ft.pdf",
    } as InvoiceRecord,
  ]);
  const [header, row] = csv.replace("﻿", "").trim().split("\r\n");
  expect(header.startsWith("Cliente;Estado;Tipo")).toBe(true);
  expect(row).toBe(
    '"Alfa; Lda";A rever;Fatura;FT 1;;2026-11-02;F;500000000;;;100,00;23,00;123,50;EUR;ft.pdf',
  );
});

it("invoicesToCsv neutraliza texto que o Excel leria como fórmula", () => {
  const csv = invoicesToCsv([
    {
      clientName: "=HYPERLINK(1)",
      status: "EXTRAIDA",
      docType: "FT",
      number: "+1",
      atcud: null,
      issueDate: null,
      issuerName: "@x",
      issuerNif: null,
      buyerName: null,
      buyerNif: null,
      netTotal: -5,
      vatTotal: null,
      total: null,
      currency: "EUR",
      fileName: "f.pdf",
    } as InvoiceRecord,
  ]);
  const row = csv.trim().split("\r\n")[1];
  expect(row.startsWith("'=HYPERLINK(1);")).toBe(true);
  expect(row).toContain(";'+1;");
  expect(row).toContain(";'@x;");
  expect(row).toContain(";-5,00;");
});
