# AI Office: o que o escritório lê daqui

O AI Office (`ElevateOne-PT/ai-office`) mostra as automações como colaboradores digitais. Este
sistema é a fonte da verdade: grava o que cada agente faz e expõe-no numa API. O escritório só lê.

## A API

```
GET <APP_URL>/api/office/eventos?desde=<n>&limite=<1..500>&apos=<ISO 8601>
Authorization: Bearer <OFFICE_API_TOKEN>
```

| Parâmetro | Por omissão | Para quê                                                                    |
| --------- | ----------- | --------------------------------------------------------------------------- |
| `desde`   | `0`         | O `n` do último evento já recebido: vêm só os seguintes                     |
| `limite`  | `200`       | Quantos eventos, no máximo                                                  |
| `apos`    | (nenhum)    | Só eventos a partir deste instante (o início do dia, ao abrir o escritório) |

Responde `401` sem o token certo, `503` se `OFFICE_API_TOKEN` não estiver definido e `400` com
parâmetros inválidos.

```json
{
  "agentes": [
    {
      "id": "assistente-isabel",
      "nome": "Assistente da Isabel",
      "funcao": "Trata da agenda, do email e dos documentos da Isabel pelo WhatsApp"
    }
  ],
  "eventos": [
    {
      "n": 41,
      "agora": 1794477600000,
      "agente": "assistente-isabel",
      "estado": "trabalho",
      "tipo": null,
      "texto": "A tratar de um pedido da Isabel",
      "ferramenta": null,
      "minutos": 0
    },
    {
      "n": 42,
      "agora": 1794477612000,
      "agente": "assistente-isabel",
      "estado": "trabalho",
      "tipo": "marcacao",
      "texto": "Marcou uma reunião",
      "ferramenta": "calendar",
      "minutos": 5
    },
    {
      "n": 43,
      "agora": 1794477613000,
      "agente": "assistente-isabel",
      "estado": "pausa",
      "tipo": null,
      "texto": "Disponível",
      "ferramenta": null,
      "minutos": 0
    }
  ],
  "proximo": 43,
  "haMais": false
}
```

Os campos de cada evento são os da `Entrada` de `src/mapa/atividade.ts` do ai-office (`n`,
`agora`, `agente`, `tipo`, `texto`, `ferramenta`, `minutos`), mais o `estado`
(`trabalho` | `pausa` | `ajuda`, o `EstadoDoAgente` de lá). `tipo` e `ferramenta` só tomam os
valores que o escritório já sabe desenhar (`src/server/models/agent-event.model.ts`).

## Como ler cada evento

| O evento                                | O que quer dizer                  | No registo `Atividade` do ai-office        |
| --------------------------------------- | --------------------------------- | ------------------------------------------ |
| `tipo: null`, `estado: "trabalho"`      | O agente começou a tratar de algo | `estar(agente, "trabalho", texto)`         |
| `tipo: null`, `estado: "pausa"`         | Acabou e ficou livre              | `estar(agente, "pausa", texto)`            |
| `tipo` de tarefa (`marcacao`, `email`…) | Uma tarefa feita, com `minutos`   | uma entrada na atividade e nas contas      |
| `tipo: "alerta"`, `estado: "ajuda"`     | Algo falhou: precisa de ajuda     | `estar(agente, "ajuda", texto)` e o alerta |

Os euros poupados continuam a ser contas do escritório: a soma dos `minutos` ao `custoHora` do
`clientes/<id>.json`.

## O que falta do lado do ai-office

1. `clientes/isabel.json` (nome, logótipo, cores, `custoHora`).
2. A equipa por cliente: hoje os agentes são os dez de `src/mapa/agentes.ts`. Os desta API
   (`agentes`) precisam de um posto e de uma aparência no mapa.
3. Uma rota no servidor do ai-office que chame esta API com o token (o token não vai para o
   browser) e um adaptador que, de poucos em poucos segundos, peça `?desde=<proximo>` e conte ao
   registo `Atividade` o que chegou, no lugar das cenas simuladas. Ao abrir, pede-se
   `?apos=<início do dia>` para as contas do dia começarem certas.
4. Decidir o que os colaboradores fazem no mapa enquanto não chegam eventos (as cenas de pausa
   podem ficar como estão).
