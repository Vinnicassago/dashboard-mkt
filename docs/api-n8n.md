# API do painel para o n8n (live 01/12)

Base: `https://<seu-painel>/api/n8n` · Todas as chamadas levam o cabeçalho

```
Authorization: Bearer <N8N_API_TOKEN>
Content-Type: application/json
```

`N8N_API_TOKEN` é uma variável de ambiente do servidor (EasyPanel). Gere um valor
longo e aleatório (ex.: `openssl rand -hex 32`) e use o mesmo no n8n (credencial
"Header Auth"). Sem a variável a API responde **503**; token errado, **401**.

A chave do lead é o **WhatsApp**: só dígitos, com 55 e DDD (`5511999990000`). O
painel aceita o número em qualquer formato e normaliza. A mesma pessoa inscrita
duas vezes **atualiza** a ficha — nunca vira um segundo lead.

Respostas de opção aceitam o texto do formulário (com ou sem acento, "R$" e
espaços) ou a chave. Valor fora da lista → **422** com o campo errado em `erros`.

| Campo | Opções (texto) | Chave devolvida |
|---|---|---|
| `bem` | Imóvel · Carro · Bem para a empresa · Outro | `imovel` `carro` `empresa` `outro` |
| `valor` | Até R$50 mil · R$50 mil a R$150 mil · R$150 mil a R$300 mil · R$300 mil a R$500 mil · R$500 mil a R$1 milhão · Acima de R$1 milhão | `ate_50k` `50k_150k` `150k_300k` `300k_500k` `500k_1m` `acima_1m` |
| `finalidade` | Morar · Investir ou alugar · Trocar de carro · Empresa · Quitar dívidas ou ter dinheiro na mão | `morar` `investir` `trocar_carro` `empresa` `quitar_dividas` |
| `parcela` | Até R$1.500 · R$1.500 a R$3.000 · R$3.000 a R$6.000 · Acima de R$6.000 | `ate_1500` `1500_3000` `3000_6000` `acima_6000` |
| `prazo` | Preciso agora · Em até 1 ano · De 1 a 3 anos · Mais de 3 anos | `agora` `ate_1_ano` `1_3_anos` `mais_3_anos` |
| `classe` | A · B · C · X | `A` `B` `C` `X` |
| `horario_preferido` | Manhã · Tarde · Noite | `manha` `tarde` `noite` |

Datas em ISO 8601 com fuso (`2026-11-16T19:05:00-03:00`). Em campos "quando
aconteceu", `true` vale "agora".

---

## 1. Inscrição — `POST /api/n8n/leads`

Cria o lead ou, se o WhatsApp já existe, atualiza a ficha. **201** = criado,
**200** = atualizado.

```json
{
  "nome": "Maria Souza",
  "whatsapp": "11 99999-0000",
  "email": "maria@exemplo.com",
  "bem": "Imóvel",
  "valor": "R$300 mil a R$500 mil",
  "finalidade": "Morar",
  "parcela": "R$1.500 a R$3.000",
  "prazo": "Em até 1 ano",
  "classe": "A",
  "aceite_mensagens": true,
  "horario_preferido": "Noite",
  "utm_source": "meta",
  "utm_medium": "paid_social",
  "utm_campaign": "120200000000000011",
  "utm_term": "120210000000000011",
  "utm_content": "120230000000000101",
  "event_id": "o-mesmo-do-pixel-se-tiver",
  "inscrito_em": "2026-11-16T19:05:00-03:00"
}
```

Só `whatsapp` é obrigatório. `event_id` (o mesmo do Pixel/`/api/track`) junta a
ficha ao cadastro que a página já mandou. O painel **calcula a classe** pelas
respostas; a que o n8n manda fica ao lado, e as duas diferentes viram aviso.

Resposta (o mesmo formato em todas as rotas):

```json
{
  "ok": true,
  "criado": true,
  "lead": {
    "id": "LEAD-WA-5511999990000",
    "nome": "Maria Souza",
    "whatsapp": "5511999990000",
    "classe": "A", "classe_painel": "A", "classe_n8n": "A", "classe_diverge": false,
    "bem": "imovel", "valor": "300k_500k", "parcela": "1500_3000", "prazo": "ate_1_ano",
    "rotulos": { "bem": "Imóvel", "status_atendimento": "Novo" },
    "status": "lead", "status_atendimento": "novo",
    "na_fila": true, "etapa_fila": "primeira",
    "prazo_tentativa": "2026-11-16T23:05:00.000Z", "atrasado": false,
    "tentativas": [], "tentativa_1_em": null, "tentativa_2_em": null, "tentativa_3_em": null,
    "resultado_contato": null,
    "msg1_enviada_em": null, "msg1_status": null,
    "eduardo_avisado_em": null, "escalado_em": null,
    "clicou_comunidade": false, "comunidade_em": null,
    "diagnostico": null, "reuniao_em": null, "reuniao_status": null,
    "link_ficha": "https://<seu-painel>/leads/LEAD-WA-5511999990000"
  }
}
```

`prazo_tentativa` é o prazo da próxima ação (A: 1 hora do turno, ou o início do
horário escolhido + 1 h; B: o fim do turno). C e X: `na_fila: false`.

## 2. Fatos do fluxo — `PATCH /api/n8n/leads/{whatsapp}`

Mande só o que aconteceu; o resto fica como está. Pode juntar vários num envio.

```json
{
  "msg1_enviada_em": "2026-11-16T19:05:20-03:00",
  "msg1_status": "enviada",
  "horario_preferido": "Manhã",
  "eduardo_avisado_em": true,
  "escalado_em": "2026-11-16T20:15:00-03:00",
  "clicou_comunidade": true,
  "comunidade_em": "2026-11-16T19:30:00-03:00",
  "diagnostico": {
    "respostas": ["resposta 1", "resposta 2", "…", "resposta 9"],
    "perfil": "Comprador planejado",
    "feito_em": "2026-11-17T10:00:00-03:00"
  }
}
```

- `msg1_enviada_em`, `eduardo_avisado_em`, `escalado_em` e `comunidade_em` são
  gravados **uma vez** (a 1ª vale). `msg1_status` (enviada · entregue · lida ·
  falhou) muda a cada envio.
- `diagnostico.respostas` aceita lista de textos ou de `{ "pergunta", "resposta" }`.

**Tentativa** (o Eduardo ligou — ou o n8n registra por ele):

```json
{
  "tentativa": {
    "em": "2026-11-16T19:40:00-03:00",
    "canal": "ligacao",
    "resultado": "Não atendeu",
    "notas": "caixa postal"
  }
}
```

`canal`: `ligacao` · `whatsapp` (ou `audio`) · `email`. `resultado`: Falou ·
Agendou · Não atendeu · Número inválido · Sem interesse. "Agendou" precisa de
`reuniao_em` no mesmo envio; "Número inválido" e "Sem interesse" encerram o lead.
A próxima tentativa sai da cadência do turno (áudio 4 h do turno depois; ligação
24 h depois).

**Reunião:**

```json
{ "reuniao_status": "Agendada", "reuniao_em": "2026-11-25T19:00:00-03:00" }
```

`reuniao_status`: Agendada (com `reuniao_em`) · Confirmada · Realizada · Não
compareceu · Remarcar (com `reuniao_em` já remarca; sem, fica "pediu para
remarcar").

**Sem resposta** (48 h sem contato válido):

```json
{ "status": "Sem resposta" }
```

É o único status gravado direto; os outros saem da tentativa e da reunião.
Quando a régua não deixa (ex.: confirmar reunião de quem não agendou), a resposta
é **409** com `erro` e `aplicado` (o que já foi gravado antes do passo que parou).

## 3. Ficha — `GET /api/n8n/leads/{whatsapp}`

Devolve `{ "ok": true, "lead": { … } }` no formato acima. **404** se o número não
for de nenhum lead.

## 4. Pendentes — `GET /api/n8n/pendentes`

A Fila da live: A e B esperando tentativa, do prazo mais antigo para o mais novo.

- Checagem de 10 em 10 min: `GET /api/n8n/pendentes?vencidos=1`
- Fila do início do turno: `GET /api/n8n/pendentes`
- Filtros: `classe=A` (ou `A,B`), `ate=2026-11-16T22:00:00-03:00`

```json
{
  "ok": true,
  "gerado_em": "2026-11-16T23:40:00.000Z",
  "total": 2,
  "atrasados": 1,
  "itens": [
    {
      "id": "LEAD-WA-5511999990000",
      "nome": "Maria Souza",
      "whatsapp": "5511999990000",
      "classe": "A",
      "etapa_fila": "primeira",
      "prazo_tentativa": "2026-11-16T23:05:00.000Z",
      "atrasado": true,
      "minutos_para_prazo": -35,
      "tentativas": 0,
      "ultima_tentativa_em": null,
      "horario_preferido": null,
      "eduardo_avisado_em": "2026-11-16T22:05:20.000Z",
      "escalado_em": null,
      "link_ficha": "https://<seu-painel>/leads/LEAD-WA-5511999990000"
    }
  ]
}
```

`etapa_fila`: `primeira` (1ª tentativa) · `cadencia` (próxima tentativa) ·
`encerrar` (48 h sem contato válido → gravar "Sem resposta") · `retornar` (falou
e não houve desfecho).

---

## 5. A página de inscrição direto no painel (sem token)

A página manda a inscrição ao painel pelo `lp-tracking.js` (o mesmo de hoje), **com
as 5 respostas**: o lead entra já classificado e na Fila, mesmo que o n8n atrase
ou esteja fora do ar. O n8n continua gravando o resto da ficha pela API acima — a
mesma pessoa pelos dois caminhos é um lead só.

Instalação (antes do `</body>`, depois do Pixel):

```html
<script>
  window.__DASH_CONFIG = {
    endpoint: "https://<seu-painel>/api/track",
    ingestKey: "<TRACK_INGEST_KEY>"
  };
</script>
<script src="https://<seu-painel>/lp-tracking.js"></script>
```

No envio do formulário (quiz ou formulário em JavaScript), com o texto das opções
como aparece na página:

```js
window.dashTrackLead({
  name: nome, email: email, phone: whatsapp,
  eventId: codigo,            // o mesmo id do Pixel (deduplica o Lead)
  bem: "Imóvel", valor: "R$300 mil a R$500 mil", finalidade: "Morar",
  parcela: "R$1.500 a R$3.000", prazo: "Em até 1 ano",
  aceite_mensagens: true      // a caixa do aceite: marcada ou não
});
```

Num `<form data-track="lead-form">` comum, basta os campos se chamarem `bem`,
`valor`, `finalidade`, `parcela`, `prazo` e `aceite_mensagens`. A classe NÃO vem
da página (o painel calcula); resposta fora da lista é ignorada sem perder o lead.

**Eventos na Meta (E2-19).** O Pixel da página manda só o `Lead`, com o mesmo
`eventId` do `dashTrackLead` (o painel manda o mesmo `Lead` pela Conversions API e
a Meta deduplica). Os outros dois saem **só pelo painel**, pela Conversions API —
não instale no Pixel, ou a Meta conta duas vezes:

| Evento (nome exato) | Quando | Detalhe |
|---|---|---|
| `LeadQualificado` | a classe vira A ou B pela 1ª vez | `custom_data.classe` = A ou B |
| `EntrouNaComunidade` | o n8n grava `comunidade_em` | hora do clique como `event_time` |

Cada um sai uma vez por lead; na Meta, crie conversões personalizadas com esses nomes.

---

Turno, feriados, faixas de horário e a tabela de parcela da classe ficam em
**Configurações → Atendimento e classe**. Telefone e e-mail nunca vão para o log.
