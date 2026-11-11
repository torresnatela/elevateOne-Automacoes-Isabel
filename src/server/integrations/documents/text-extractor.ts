import { AppError } from "@/server/lib/errors";

export interface SourceFile {
  fileName: string;
  mimeType: string;
  data: Uint8Array;
}

/** Tira o texto de um ficheiro. A base de conhecimento depende desta interface. */
export interface TextExtractor {
  extract(file: SourceFile): Promise<string>;
}

export class UnsupportedFileError extends AppError {
  constructor() {
    super(
      "Tipo de ficheiro não suportado. Use PDF, DOCX, TXT ou MD.",
      415,
      "UNSUPPORTED_FILE_TYPE",
    );
  }
}

export type FileKind = "pdf" | "docx" | "text";

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "docx",
  txt: "text",
  md: "text",
  markdown: "text",
};

const BY_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
};

/** O tipo de um ficheiro, pela extensão e, sem ela, pelo tipo que o browser disse. */
export function fileKind(fileName: string, mimeType: string): FileKind | null {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (extension && BY_EXTENSION[extension]) || BY_MIME[mimeType.split(";")[0].trim()] || null;
}

/** PDF (unpdf), DOCX (mammoth) e texto simples. Um PDF digitalizado, sem texto, dá vazio. */
export class FileTextExtractor implements TextExtractor {
  async extract(file: SourceFile): Promise<string> {
    switch (fileKind(file.fileName, file.mimeType)) {
      case "pdf": {
        const { extractText, getDocumentProxy } = await import("unpdf");
        // O unpdf fica com o buffer: dá-se-lhe uma cópia.
        const pdf = await getDocumentProxy(new Uint8Array(file.data));
        const { text } = await extractText(pdf, { mergePages: true });
        return text;
      }
      case "docx": {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(file.data) });
        return value;
      }
      case "text":
        return new TextDecoder("utf-8").decode(file.data);
      default:
        throw new UnsupportedFileError();
    }
  }
}
