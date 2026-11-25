import { AppError } from "@/server/lib/errors";
import type { Fetch } from "./oauth";

/** Um ficheiro ou pasta do OneDrive (um `driveItem` do Microsoft Graph). */
export interface OneDriveItem {
  /** O drive a que pertence: numa pasta partilhada, é o drive de quem a partilhou. */
  driveId: string;
  id: string;
  name: string;
  isFolder: boolean;
  /** Quantos itens tem lá dentro (só nas pastas). */
  childCount: number | null;
  mimeType: string | null;
  size: number | null;
  webUrl: string | null;
  modifiedAt: string | null;
  /** O caminho da pasta onde está, quando o Graph o diz (ex.: `/drive/root:/Empresa/Contratos`). */
  parentPath: string | null;
}

/** Um ficheiro descarregado. */
export interface OneDriveFileContent {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

/** O que o sistema faz no OneDrive de alguém. As ferramentas dos agentes dependem disto. */
export interface OneDrive {
  /** Uma pasta a partir de um link de partilha, ou de um caminho no OneDrive da pessoa. */
  resolveFolder(linkOrPath: string): Promise<OneDriveItem>;
  getItem(driveId: string, itemId: string): Promise<OneDriveItem>;
  listChildren(driveId: string, folderId: string, limit?: number): Promise<OneDriveItem[]>;
  /** Procura pelo nome e pelo conteúdo, dentro de uma pasta (e das pastas dela). */
  search(driveId: string, folderId: string, query: string, limit?: number): Promise<OneDriveItem[]>;
  readFile(driveId: string, itemId: string): Promise<OneDriveFileContent>;
}

/** O maior ficheiro que se descarrega para ler. */
export const MAX_ONEDRIVE_FILE_BYTES = 10 * 1024 * 1024;

const GRAPH = "https://graph.microsoft.com/v1.0";
const ITEM_FIELDS =
  "id,name,size,webUrl,lastModifiedDateTime,file,folder,package,parentReference,remoteItem";

/** O Graph respondeu com erro: de quem pediu (4xx) ou uma avaria (502). */
export class MicrosoftApiError extends AppError {
  constructor(
    readonly graphStatus: number,
    detail: string,
  ) {
    const status =
      graphStatus === 404 ? 404 : graphStatus === 403 ? 403 : graphStatus === 400 ? 422 : 502;
    super(`O OneDrive recusou o pedido (${graphStatus}): ${detail}`, status, "MICROSOFT_API_ERROR");
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- as respostas do Graph lêem-se campo a campo */
type Json = any;

/** Um link de partilha no formato que o Graph aceita em `/shares/{id}`: `u!` + base64url. */
export const shareIdOf = (url: string) =>
  "u!" + Buffer.from(url.trim(), "utf8").toString("base64url").replace(/=+$/, "");

/** Um item do Graph. Os atalhos de pastas partilhadas («Adicionar ao Meu OneDrive») apontam para o item real. */
export function toItem(raw: Json): OneDriveItem {
  const item = raw.remoteItem ? { ...raw.remoteItem, name: raw.name ?? raw.remoteItem.name } : raw;
  const isFolder = Boolean(item.folder ?? item.package?.type === "oneNote");
  return {
    driveId: item.parentReference?.driveId ?? raw.parentReference?.driveId ?? "",
    id: item.id,
    name: item.name,
    isFolder,
    childCount: item.folder?.childCount ?? null,
    mimeType: item.file?.mimeType ?? null,
    size: typeof item.size === "number" ? item.size : null,
    webUrl: item.webUrl ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
    parentPath: item.parentReference?.path ?? null,
  };
}

/** O OneDrive pelo Microsoft Graph, com o access token de quem ligou a conta. */
export class GraphOneDrive implements OneDrive {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private async call(path: string, query: Record<string, string> = {}): Promise<Json> {
    const url = new URL(`${GRAPH}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await this.fetchFn(url, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new MicrosoftApiError(res.status, data?.error?.message ?? res.statusText);
    return data;
  }

  async resolveFolder(linkOrPath: string): Promise<OneDriveItem> {
    const input = linkOrPath.trim();
    if (!input) throw new AppError("Indique o link ou o caminho da pasta.", 422, "VALIDATION_ERROR");
    const raw = /^https?:\/\//i.test(input)
      ? await this.call(`/shares/${shareIdOf(input)}/driveItem`, { $select: ITEM_FIELDS })
      : await this.call(
          `/me/drive/root:/${input
            .replace(/^\/+|\/+$/g, "")
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
          { $select: ITEM_FIELDS },
        );
    const item = toItem(raw);
    if (!item.isFolder)
      throw new AppError(
        "Isso é um ficheiro, não uma pasta. Use o link da pasta.",
        422,
        "ONEDRIVE_NOT_A_FOLDER",
      );
    return item;
  }

  async getItem(driveId: string, itemId: string) {
    return toItem(
      await this.call(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`, {
        $select: ITEM_FIELDS,
      }),
    );
  }

  async listChildren(driveId: string, folderId: string, limit = 200) {
    const data = await this.call(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}/children`,
      { $select: ITEM_FIELDS, $top: String(limit), $orderby: "name" },
    );
    return (data.value ?? []).map(toItem);
  }

  async search(driveId: string, folderId: string, query: string, limit = 25) {
    const q = query.replace(/'/g, "''");
    const data = await this.call(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}/search(q='${encodeURIComponent(q)}')`,
      { $select: ITEM_FIELDS, $top: String(limit) },
    );
    return (data.value ?? []).map(toItem);
  }

  async readFile(driveId: string, itemId: string): Promise<OneDriveFileContent> {
    const item = await this.getItem(driveId, itemId);
    if (item.isFolder)
      throw new AppError("Isso é uma pasta, não um ficheiro.", 415, "ONEDRIVE_NOT_A_FILE");
    if ((item.size ?? 0) > MAX_ONEDRIVE_FILE_BYTES)
      throw new AppError(
        "O ficheiro é grande demais para ler (o máximo são 10 MB).",
        413,
        "ONEDRIVE_FILE_TOO_LARGE",
      );
    // O Graph responde com um redirecionamento para um endereço já autorizado, noutro domínio.
    const res = await this.fetchFn(
      `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
      { headers: { authorization: `Bearer ${await this.accessToken()}` } },
    );
    if (!res.ok) throw new MicrosoftApiError(res.status, res.statusText);
    return {
      name: item.name,
      mimeType: item.mimeType ?? "application/octet-stream",
      data: new Uint8Array(await res.arrayBuffer()),
    };
  }
}
