-- A base de conhecimento deixa de usar embeddings (OpenAI): a procura passa a ser por
-- texto completo do Postgres, em português e sem acentos. O Claude lê os excertos e escolhe.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- O `unaccent` não é IMMUTABLE; a coluna gerada e o índice precisam de uma versão que seja.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding";

-- Os pedaços que já existem ficam indexados aqui: não é preciso voltar a enviar os ficheiros.
ALTER TABLE "knowledge_chunks"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', immutable_unaccent("content"))) STORED;

CREATE INDEX "knowledge_chunks_search_vector_idx" ON "knowledge_chunks" USING GIN ("search_vector");
