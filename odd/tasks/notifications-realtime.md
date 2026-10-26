# Notifications realtime — `notification.created` frame (slice 3)

Objective: emit one minimal `notification.created` frame per *created* notification and
deliver it only to the owner's sockets, then route it on the front instead of treating
every frame as an activities refetch. Branches: back `ft/notification-read`, front
`sdd/activity-swipe-actions`. Delivery: three reviewable units, no PR until asked.
Test runners: back `pnpm test` + `pnpm build`; front `./gradlew :shared:testDebugUnitTest`.

## Specs

- **S1 (frame contract).** One frame shape, no title/body on the socket:

  ```json
  {
    "v": 1,
    "type": "notification.created",
    "notificationId": "<uuid>",
    "userId": "<uuid>",
    "notificationType": "activity.assigned",
    "refEntityType": "activity",
    "refEntityId": "<uuid>",
    "occurredAt": "<ISO-8601>"
  }
  ```

  `userId` is the routing key: the gateway strips it before writing to the socket.
- **S2 (one frame per created row).** `NotificationFanOutService.handleOutboxEvent`
  returns the notifications it actually created. A deduplicated insert
  (`ON CONFLICT DO NOTHING` → `null`) contributes no frame, so a re-dispatched event
  emits nothing.
- **S3 (publish after commit).** Frames are published only after the dispatch
  transaction commits; a rolled-back dispatch publishes nothing. A realtime failure can
  never fail the dispatch (the publisher never throws).
- **S4 (per-user delivery).** The gateway sends `notification.created` to the sockets
  registered for `userId` only, and to each socket exactly once. No bond-member query is
  involved. `activity.changed` keeps broadcasting to active bond members.
- **S5 (subscriber).** The subscriber emits a typed union and drops frames whose `type`
  is unknown or whose shape is malformed, with a warning — never forwarding them.
- **S6 (front routing).** The front parses the frame envelope by `type`:
  `activity.changed` feeds the activities resync signal, `notification.created` feeds a
  separate notifications signal, and an unrecognised `type` is dropped.
- **S7 (no regression).** `activity.changed` keeps its current payload, fan-out
  behaviour and front resync path.

Out of scope for this slice: consuming `notificationSignals` from the badge/list (needs
the connection manager hoisted to session scope), notification deep links, and webhook
subscription management from the client.

## Tasks

| ID  | Specs   | Route  | Status  | Commit |
| --- | ------- | ------ | ------- | ------ |
| T1  | S1-S3   | inline | done    | `3ce43fb` |
| T2  | S4-S5   | inline | done    | `9660811` |
| T3  | S6-S7   | inline | done    | `58a9611` (front) |

## Log

- **L1.** Usuario: "yes, explain in few words the next thing that we are going to work".
  Autoriza la mitad back de la slice 3: frame mínimo `notification.created` + entrega
  por usuario.
- **L2.** Decisión previa (checkpoint de la slice 2/4): el publish vive en
  `FanOutService.dispatch`, después del commit, no en `Relay`, porque es `dispatch`
  quien conoce las notificaciones creadas; un rollback no puede emitir un frame fantasma.
- **L3.** `REALTIME_CHANNEL` se reutiliza tal cual: un solo canal pub/sub, el `type` del
  frame discrimina. No se agrega canal nuevo ni se toca `activity.changed`.
- **L4 (evidencia T1).** RED observado primero: con las tres fuentes en stash, las
  suites fallan por compilación (`publishNotificationCreated` inexistente, 6º argumento
  del constructor de `FanOutService`). GREEN después:
  `npx jest src/realtime src/notifications/fan-out src/webhooks/dispatcher` → 14 suites,
  135 tests verdes; `pnpm build` → exit 0. El spec del DTO nuevo pasa en ambos estados
  porque el builder sólo depende del archivo nuevo (no había código previo que romper).
- **L5 (evidencia T2).** RED observado con `realtime-subscriber.service.ts` y
  `realtime.gateway.ts` en stash: 5 tests fallan (frame desconocido reemitido, y los
  cuatro de entrega por usuario). GREEN después: `npx jest src/realtime` → 7 suites,
  54 tests verdes; `pnpm build` → exit 0.
- **L6 (evidencia T3, front).** RED observado simulando el ruteo viejo (todo frame al
  coalescer de actividades): el test nuevo falla en
  `RealtimeConnectionManagerTest.kt:206` ("una notificación no debe recargar
  actividades"). GREEN después: `./gradlew :shared:testDebugUnitTest` → 153 tests,
  0 fallos (8 nuevos de parseo + 1 de ruteo); `:androidApp:assembleDebug` →
  BUILD SUCCESSFUL.
- **L7 (cierre back).** `pnpm test` → 69 suites, 755 tests, 0 fallos.
- **Pendiente (slice 3, follow-up).** `notificationSignals` todavía no tiene consumidor:
  el manager del front vive dentro de la pestaña Actividades y el badge está en Home, así
  que suscribirlo exige subir el manager al scope de sesión en `App.kt`. Hasta entonces la
  slice elimina el refetch espurio y deja el punto de extensión probado, pero el badge
  sigue actualizándose sólo por su poll de 30 s y su recarga al abrir.
- **Riesgo.** Item 3 (contrato consumido): el frame `notification.created` y el sobre por
  `type` son un contrato entre back y front; un cliente viejo los descarta (no rompe), pero
  cambiar la forma después exige versionar `v`.
