# Terciarios con identidad propia

**Objetivo**: que un progenitor pueda crear un acceso temporal con datos de contacto
(nombre, apellido, teléfono, documento), que ese terciario sea asignable como
asignatario de actividades con su nombre visible, y que las cards muestren el nombre
del terciario sólo a quien lo autorizó; los demás miembros ven "Autorizado por YO".

**Ramas**: `feature/thirdparty-identity` en ambos repos, desde `develop`.
**Delivery**: commits unitarios convencionales en ambas ramas; no push ni PR salvo pedido.
**Test runner back**: `pnpm test` / jest (spec por servicio). **Front**: `./gradlew :shared:testDebugUnitTest`.
**Espejo back de este doc**: `odd/tasks/thirdparty-identity.md` en `parental_coordination_back`
(los writers del back necesitan `Spec: odd/tasks/thirdparty-identity.md, T<n>` en su propio repo).

## Specs

- **S1** — "yo poder crear un terciario y agregarle los nombres y algun dato mas ahi":
  el alta de acceso temporal captura y persiste `firstName`, `lastName`, `phone`,
  `document` (todos obligatorios salvo indicación del usuario; los dos primeros se
  muestran en pantalla). El alta existente por email no cambia de forma.
- **S2** — "cuando yo creo una actividad y se la puedo asignar a alguien tiene que
  aparecer el nombre de ese terciario": el dropdown de asignatarios incluye a los
  terciarios activos del vínculo como opciones elegibles, con su nombre completo.
- **S3** — "en las cards de activities tiene que mostrarse el nombre del terciario
  para el que lo autorizo, para los demas solo muestra quien lo autorizo": en
  `ActivityCard`, si la actividad fue creada por un terciario, quien lo autorizó ve
  el nombre del terciario ("Pablo Charles"); cualquier otro miembro ve
  "Autorizado por <nombre del autorizante>".
- **S4** — los campos nuevos viajan como `firstName|lastName|phone|document` en el
  JSON del alta (`POST /bonds/:bondId/third-parties`) y en la respuesta de
  `GET /bonds/:bondId/third-parties` y `GET /third-parties/me`.
- **S5** — la política de visibilidad (S3) vive en una única función/policy del shared,
  cubierta por unit tests que fijen el caso del autorizante y el caso del otro miembro.
- **S6** — degradation: si el back viejo no manda los campos nuevos (nullable con
  default), ni el alta, ni el dropdown, ni las cards se rompen.
- **S7** — los datos de la ex-mujer NO pueden ver el nombre real: la visibilidad de
  "Pablo Charles" la decide el SERVIDOR. El payload de actividades llega con
  `attribution = null | { kind: "member", name } | { kind: "third_party", name?, authorizedByName }`
  donde `name` sólo presente si el requester es el autorizante del grant; el front
  nunca recibe el nombre real si no lo puede pintar.
- **S8** — el enmascaramiento viewer-aware también aplica al propio `GET /bonds`:
  el autorizante ve el nombre real del terciario en la lista de miembros; otro
  miembro ve la máscara actual.
- **S9** — "le podes otorgar los datos al third party ya creado": el PATCH de un
  acceso vigente también acepta identidad (`firstName`, `lastName`, `phone`,
  `document`); los campos presentes se aplican, los ausentes NO borran lo
  persistido (mismo PATCH parcial que relationship/accessEnd/note).

## Tareas

- T1 (S1) back: ampliar `CreateThirdPartyDto`, entidad `auth_third_party` (columnas
  `first_name`, `last_name`, `phone`, `document`), migración TypeORM y response DTO.
  Espec `Spec: odd/tasks/thirdparty-identity.md, T1`.
- T2 (S1) back: test de servicio para el alta con los campos nuevos.
- T3 (S1) front: formulario de alta con nombre, apellido, teléfono, documento; DTO
  `CreateThirdPartyAccessRequest` y `ThirdPartiesApi.toCreateBody()`.
- T4 (S2) front: dropdown de asignatarios con terciarios activos elegibles; modelo
  `Actividad` acepta asignatario terciario.
- T5 (S3, S5) front: policy única de atribución + render en `ActivityCard`/`AgendaTimelineRow`.
- T6 (S5, S6) front: tests de policy, degradación y formulario.
- T7 (S4, S7) back: atribución de autoría en la lista/detalle de actividades
  (`createdBy` + `attribution` según S7), service test incluido.
- T8 (S2, S8) back: `hideThirdPartyIdentity` viewer-aware (autorizante ve nombre
  real en `GET /bonds`); asignación de terciario validada (`assignedTo` acepta su
  user id).
- T9 (S9) back DONE `9d4a55a` (back repo) — `UpdateThirdPartyDto` acepta identidad opcional; PATCH aplica sólo
  campos presentes; service test incluido.
- T10 (S9) front DONE `158f381` — hoja de edición precargada (identidad del grant);
  toPatchBody parcial; 2 tests nuevos. Suite 76/758.

## Estado final

- Front: rama `feature/thirdparty-identity`, 2 commits (`8643b4c`, `4aa381d`).
- Back: rama `feature/thirdparty-identity`, 2 commits (`9410292`, `1beb690`).
- Deuda conocida (del worker del back): `findThirdPartyDisplayNames` sin spec SQL de
  repositorio; guard de método opcional en `bonds.service` mientras exista el double
  viejo del T12-verifier; hot path de listByBond +3 queries fijas por request (O(1),
  no N+1).

## Log

- L4 (verbatim): "le podes otorgar los datos al third party ya creado? Ahora subi esto a github .. y pasamos a la parte de actividades." — abre S9 (edición de identidad de grants existentes); push autorizado en ambos repos.

- L1 (verbatim): "la idea primero es yo poder crear un terciario y agregarle los nombres
  y algun dato mas ahi .. luego cuando yo creo una actividad y se la puedo asignar a
  alguien tiene que aparecer elnombre de ese terciario, hoy aparece como Autorizado por
  Angelo .. luego en las cards de activities tiene qe mostrarse el nombre del terciario
  para el que lo autirzo , para los demas solo muestra quien lo autirzo"
- L2 (decisión): datos de alta = nombre + apellido + teléfono + documento;
  asignación = terciario como opción en dropdown; trabajo crosses ambos repos.
- L3 (evidencia): back en `/home/angelo/Documentos/parental_coordination_back`,
  ruta `/third-parties`, entidad `auth_third_party` (src/expenses/entities/),
  `CreateThirdPartyDto` sólo acepta email/relationship/accessEnd/note hoy.
