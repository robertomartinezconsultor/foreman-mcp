# Friction log — Amazon Developer Hackathon (Alexa+ / MCP)

Formato por entrada, listo para pegar en el formulario de Devpost: tarea intentada,
pasos, esperado vs. real, severidad, workaround y sugerencia accionable.
(Los friction logs pueden dar hasta 10% de bono de judging; se evalúan en la Etapa 1.)

## 2026-10-16 — Servidor MCP stateless con el SDK de TypeScript

- **Tarea intentada:** servir un McpServer compartido sobre
  `StreamableHTTPServerTransport` con `sessionIdGenerator: undefined` (modo
  stateless) tras un `node:http` plano.
- **Pasos:** conectar un solo transporte al arrancar; enviar `initialize`
  (OK, negoció 2025-11-25); enviar `tools/list` como POST independiente.
- **Esperado:** `tools/list` responde la lista de tools en modo stateless.
- **Real:** `tools/list` devolvió HTTP 500 sin cuerpo; nada en el log del
  servidor salvo el error capturado por nuestro handler.
- **Severidad:** media (bloquea el patrón de servidor compartido; el arreglo es claro).
- **Workaround:** patrón oficial stateless del SDK: crear `McpServer` +
  transporte **por request**, conectar, atender y cerrar al cerrar la respuesta.
  Con eso `initialize`, `tools/list` y `tools/call` responden correctamente.
- **Sugerencia accionable:** documentar en la guía de inicio de Alexa+/MCP que el
  transporte compartido no es válido en modo stateless y mostrar el patrón
  por-request como el ejemplo canónico "hello world" para Node sin framework.
---

## 2026-10-17 — El estado del negocio no puede vivir en el servidor MCP stateless

- **Tarea intentada:** darle al servidor "estado entre sesiones" (la propia
  guía de Alexa+ lo marca como el patrón creativo): que las obras, prospectos
  y el outbox sobrevivan entre llamadas y reinicios.
- **Pasos:** partir del patrón stateless oficial (instancia de `McpServer`
  nueva por request, ver entrada anterior) y buscar dónde se supone que vive
  el estado de larga duración en los ejemplos de arranque.
- **Esperado:** un patrón documentado de estado persistente para servidores
  MCP autoalojados sin estado.
- **Real:** los ejemplos mantienen el estado en variables del proceso ligadas
  a la instancia del servidor; con el patrón por-request esa instancia es
  desechable y el estado "de demo" se reinicia en silencio. Nada en el
  camino de arranque advierte que el estado debe externalizarse.
- **Severidad:** media (no bloquea, pero induce a construir exactamente el
  "wrapper sin memoria" que la guía castiga como obvio).
- **Workaround:** store persistente en disco fuera del ciclo de vida del
  `McpServer`: singleton compartido, escritura atómica (tmp + rename) en
  cada mutación y log de auditoría; probado con dos arranques del servidor
  sobre el mismo archivo (transcripciones en `docs/evidence/`).
- **Sugerencia accionable:** incluir en la guía de Alexa+/MCP una sección
  "state between sessions" con el patrón de store externalizado como
  ejemplo, ya que es el comportamiento que los criterios premian.
---

## 2026-10-17 — No hay un cliente oficial ligero para probar el servidor "como lo llamaría Alexa+"

- **Tarea intentada:** verificar de punta a punta que el servidor responde
  como Alexa+ lo consumiría: `initialize`, `tools/list` y `tools/call` de
  las 11 tools, con reinicio intermedio.
- **Pasos:** buscar en el material de arranque un simulador o cliente de
  prueba oficial para servidores MCP autoalojados de la pista Alexa+.
- **Esperado:** una herramienta oficial de humo (CLI o web) que negocie el
  protocolo y ejerza las tools sin montar un cliente Alexa+ completo.
- **Real:** no lo encontramos en el camino de onboarding; hubo que escribir
  un cliente JSON-RPC propio. Detalle que cuesta tiempo: aun para una
  respuesta única y síncrona, el transporte responde `text/event-stream`
  (marco `event: message` + línea `data:`), y la negociación de contenido
  exige que el `Accept` incluya ambos tipos; un cliente "solo JSON" no
  llega a las tools.
- **Severidad:** media (cada equipo reinventa el mismo arnés de prueba; los
  errores de negociación se confunden con errores del servidor).
- **Workaround:** cliente mínimo propio (`scripts/mcp-client.mjs`)
  que entiende JSON y SSE, más una compuerta automática de 44 aserciones
  en dos arranques (`scripts/verify.mjs`) que corre antes de
  reportar cualquier avance.
- **Sugerencia accionable:** publicar un "MCP smoke tester" oficial para la
  pista (pegar URL del endpoint, corre initialize/list/call y reporta) y
  documentar el requisito de `Accept` con un ejemplo curl completo.
---
