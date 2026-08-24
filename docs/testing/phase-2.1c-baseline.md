# Fase 2.1C: baseline de migracion del paciente

## Capas y comandos

| Capa | Comando | Dependencias externas | Estado |
| --- | --- | --- | --- |
| Unit | `npm run test:unit` | Ninguna | Ejecutable |
| Integration | `npm run test:integration` | Java 21+; Firestore Emulator local | Ejecutable |
| Security | `npm run test:security` | Java 21+; Firestore Emulator local | Ejecutable; incluye dos objetivos futuros omitidos |
| Integration + Security | `npm run test:emulator` | Java 21+; Firestore Emulator local | Ejecutable secuencialmente |
| E2E | No se expone comando en 2.1C | Requiere navegador y Firebase cliente aislado | Pendiente |

`npm test` ejecuta solo la capa unit. Integration no significa objetos en memoria: levanta el
Firestore Emulator, monta la aplicacion Express real, realiza HTTP real y verifica las escrituras
posteriores mediante Firebase Admin contra el Emulator.

## Inventario inicial

- Framework unitario existente: `node:test`, con 36 casos en `tests/patientAccess.test.ts`.
- Jest/Vitest: no configurados.
- Playwright/Cypress: no configurados.
- Firebase Emulator: no estaba configurado; 2.1C incorpora `firebase.test.json` sin tocar
  `firebase.json` ni crear `.firebaserc`.
- Credenciales de test: no existian y no se crean. El proyecto `demo-*` no admite acceso accidental
  a servicios Firebase no emulados.
- La configuracion Firebase del navegador esta versionada en `firebase-applet-config.json` y apunta
  siempre al mismo proyecto/base. Por ello un Preview del frontend comparte el destino Firestore del
  navegador con Production y no es un entorno admisible para fixtures ni E2E destructivo.
- Los scripts legacy `test_firestore.ts`, `test_query.ts`, `test_probe*.ts` y `scripts/test-write.ts`
  no demuestran aislamiento y no se ejecutan en esta fase.

## Barrera anti-Production

El lanzador `scripts/run-firestore-emulator-tests.mjs` fija un proyecto ficticio con prefijo
reservado por Firebase para emulacion: `demo-ce-patient-harness`. Utiliza exclusivamente
`firebase.test.json`, la base local `(default)` y el host `127.0.0.1:8089`.

Antes de importar el backend o crear un cliente de reglas,
`tests/helpers/emulatorSafety.ts` aborta salvo que se cumpla todo lo siguiente:

1. `TEST_FIRESTORE_MODE=emulator`.
2. `FIRESTORE_EMULATOR_HOST` es `localhost` o `127.0.0.1` con puerto explicito.
3. `FIREBASE_PROJECT_ID`, `GCLOUD_PROJECT` y `GOOGLE_CLOUD_PROJECT` son exactamente el proyecto demo.
4. `FIRESTORE_DATABASE_ID` es exactamente `(default)`.
5. credenciales Admin, credenciales de aplicacion y toda URL/secreto de webhook estan vacios.
6. el secreto de rate limit tiene el prefijo sintetico reservado.

Por tanto, una ejecucion directa del runner sin Emulator, con un project ID real, con credenciales
reales o con un webhook configurado termina antes de importar `api/index.ts`. Los fixtures no tienen
marcadores SoyBienestar y no contienen PII real.

## Baseline funcional actual de `#/session?p=...`

1. `App` detecta `#/session`, decodifica el parametro Base64 `p`, exige `decoded.id` y monta
   `PatientInterface` con los datos contenidos en el enlace.
2. `PatientInterface` hidrata el documento completo mediante `DataService.getPatientById`.
3. El usuario introduce el PIN; el componente vuelve a leer el documento completo y compara en el
   navegador el PIN normalizado con `accessPin`.
4. Para `pending`/`sent`, el navegador escribe `status=viewed` y llama al endpoint legacy de evento
   `questionnaire_started`.
5. Si existe pregunta de confirmacion, el nombre aceptado se guarda directamente en el documento.
6. Las preguntas activas excluyen las marcadas `hidden`; cada respuesta se guarda directamente con
   `answers`, marcas de tiempo e indice de progreso.
7. Una recarga repite la hidratacion; las respuestas y metadatos almacenados determinan el indice de
   continuacion.
8. Al responder todas las preguntas se presenta la pantalla de fin y la opcion de revision.
9. La revision permite cambiar respuestas y marca el informe como `stale` mediante escritura directa.
10. Enviar resultados escribe directamente `answers`, `status=completed`, `dateAnswered` y
    `aiReportStatus=pending`.
11. Solo despues de confirmar esa escritura el estado local pasa a `completed`.
12. A continuacion se llaman, de forma no bloqueante para `completed`, sincronizacion SoyBienestar,
    generacion del informe y notificacion SMTP; un fallo de IA escribe directamente estado `error`.
13. Tras el mensaje/audio final (maximo 30 segundos), o al pulsar Finalizar, se redirige con
    `window.location.replace` a `https://soybienestar.es/herramientas`.

## Inventario de acceso directo a `patients/{id}` desde flujo anonimo

| Archivo | Funcion/momento | Firestore directo | Operacion | Campos/uso |
| --- | --- | --- | --- | --- |
| `components/PatientInterface.tsx` | efecto de hidratacion inicial | `DataService.getPatientById` | GET | ficha completa y progreso |
| `components/PatientInterface.tsx` | `handlePinSubmit` | `DataService.getPatientById` | GET | PIN, estado, respuestas y conclusion |
| `components/PatientInterface.tsx` | `handlePinSubmit` para `pending`/`sent` | `DataService.updatePatient` | UPDATE | `status=viewed` |
| `components/PatientInterface.tsx` | `handlePinSubmit` al abrir conclusion | `DataService.updatePatient` | UPDATE | `status=finalized`, fecha y vistas |
| `components/PatientInterface.tsx` | `handleVerification` | `DataService.updatePatient` | UPDATE | nombre confirmado y fecha |
| `components/PatientInterface.tsx` | `handleAnswer` y revision | `DataService.updatePatient` | UPDATE | respuestas, progreso y posible `stale` |
| `components/PatientInterface.tsx` | `handleSendResults` | `DataService.updatePatient` | UPDATE | respuestas, `completed`, fechas y estado IA |
| `components/PatientInterface.tsx` | `handleSendResults` tras fallo IA | `DataService.updatePatient` | UPDATE | estado/error IA |
| `components/ConclusionPatientView.tsx` | `loadData` legacy | `DataService.getPatientById` | GET | ficha completa |
| `components/ConclusionPatientView.tsx` | `handleUnlock` legacy | `DataService.updatePatient` | UPDATE | vistas, `finalized` y fecha |
| `services/dataService.ts` | implementacion de lectura | `getDoc(doc(..., 'patients', id))` | GET | devuelve documento completo |
| `services/dataService.ts` | implementacion de escritura | `updateDoc(doc(..., 'patients', id), data)` | UPDATE | acepta el mapa recibido |

Las llamadas del coordinador a los mismos helpers no forman parte del navegador anonimo y no se
migran en esta fase.

## Baseline de reglas y objetivo futuro

- Anonymous patients direct GET = currently allowed.
- Anonymous patients direct UPDATE = currently allowed si conserva el campo `id`.
- Objetivo obligatorio tras el lockdown: ambos deben ser `DENIED`.

La suite de seguridad demuestra el baseline permitido actual y conserva dos pruebas futuras
marcadas literalmente `EXPECTED FAIL UNTIL FIRESTORE LOCKDOWN`. No se modifican reglas para hacerlas
pasar en 2.1C.

## E2E

No se incorpora Playwright todavia. El frontend productivo inicializa Firebase desde
`firebase-applet-config.json` y no tiene un punto de inyeccion de Emulator. Un E2E real del flujo
actual conectaria el navegador a la base configurada para Production. Añadir ese punto de inyeccion
en `services/firebase.ts` seria ya una adaptacion funcional del frontend y queda fuera de 2.1C.

La cobertura acumulativa disponible antes de 2.2 es: unit para decisiones puras; integration HTTP,
transacciones, persistencia, idempotencia y concurrencia; security para la frontera de reglas. El E2E
aislado se habilitara cuando la migracion aporte una configuracion de cliente inequivocamente local.
