# Build & deploy del visor OHIF para fpacs (rama `fpacs`)

Esta rama es el fork del visor OHIF usado por el PACS del sanatorio (fpacs).
Base: **OHIF 3.9.0** + un commit de customización (`df28d55`: CSS mobile, PUBLIC_URL,
`Dockerfile.fpacs`/`nginx-fpacs.conf`) + traducciones al español (`0f31a9d`).

La imagen corre en la VM del PACS (`site-local`, servicio `ohif`) detrás del portal,
que la sirve bajo `/ohif/` y le mediá el acceso a DICOMweb por `/api/pacs`.

## Cómo se buildea la imagen

El build de OHIF es pesado (webpack) y se hace **aparte**; `Dockerfile.fpacs` sólo
empaqueta el `dist` ya construido en nginx. La sede no tiene egress a npm → se buildea
en otra máquina y se transfiere la imagen por `docker save | load` (NO `docker pull`).

```bash
# 1) Clonar la rama fpacs
git clone --branch fpacs --single-branch https://github.com/fpxda/ohif-viewers-fpacs.git
cd ohif-viewers-fpacs

# 2) Build del bundle en un container node:20 (aislado). En la VM dev, Docker necesita sudo.
sudo docker run --rm -v "$PWD":/app -w /app \
  -e HOME=/app -e NODE_OPTIONS=--max-old-space-size=8192 \
  -e PUBLIC_URL=/ohif/ -e NX_SKIP_NX_CACHE=true \
  node:20 bash -lc "corepack enable && rm -rf node_modules/.cache/nx .nx platform/app/dist && \
                    yarn install --frozen-lockfile && yarn build"

# 3) Empaquetar el dist en la imagen nginx (tag NUEVO, nunca pisar el anterior)
sudo docker build -f Dockerfile.fpacs -t dockerxda/fpacs-ohif:<TAG-NUEVO> .
```

## GOTCHAS (aprendidos a los golpes — no borrar)

- **`PUBLIC_URL=/ohif/` es una ENV VAR de build-time** (`webpack.pwa.js`, default `/`).
  Si NO se pasa, los assets se referencian desde la raíz (`/app.bundle.js`) y el visor
  queda roto bajo el túnel (assets 404). Verificá en `platform/app/dist/index.html`
  que diga `PUBLIC_URL = '/ohif/'` antes de empaquetar.
- **Nx cache (Lerna 7) NO invalida por env vars.** Si buildeás dos veces cambiando sólo
  `PUBLIC_URL`, Nx restaura el build viejo (con el PUBLIC_URL anterior) y encima el
  artifact de otro container falla el integrity check (exit 1). Por eso:
  `NX_SKIP_NX_CACHE=true` + `rm -rf node_modules/.cache/nx .nx` antes de cada build.
- **Node 20** (no 22): la era 3.9.0 se buildea con node 18/20; node 22 puede romper
  node-gyp de deps viejas. Yarn 1.22.22 (via corepack).
- El baseline (sin cambios) reproduce la imagen desplegada EXACTO — verificá corriendo
  el `dist` en un nginx local y comparando el toolbar contra `pacs.imed.ar`.

## Deploy a la VM del PACS (sin egress)

```bash
sudo docker save dockerxda/fpacs-ohif:<TAG-NUEVO> | gzip > ohif.tar.gz
scp ohif.tar.gz fpacs@<VM>:/tmp/
ssh fpacs@<VM> 'gunzip -c /tmp/ohif.tar.gz | sudo docker load'
# En la VM: bump del tag en infra/site-local/docker-compose.yml (servicio ohif),
# backup del compose, y: sudo docker compose up -d --force-recreate ohif
# Rollback: dejar la imagen anterior cargada y revertir el tag en el compose.
```

El `app-config.js` NO se hornea: lo monta el compose (`./ohif/app-config.js`), apunta al
proxy `/api/pacs` del portal via `window.location.origin`. Al deployar sólo cambia el tag.

## i18n

El `es` de OHIF 3.9.0 viene incompleto. Traducciones propias en
`platform/i18n/src/locales/es/` (namespaces nuevos se registran en `es/index.js`).
El idioma lo fuerza el portal con `&lng=es` en la URL (querystring-first detector
de i18next).

Desde 2026-07-15 los labels "hardcodeados" del toolbar/menús SÍ pasan por i18n:
se parcharon los componentes para que traduzcan con el namespace que corresponde
(`ToolbarButton`/`SplitButton` → `Buttons`, `ContextMenu` → `ContextMenu`,
selector de layout → `LayoutSelector`, menú W/L → `WindowLevelActionMenu`, y los
prompts de tracking/diálogos usan `i18n.t()` directo). Regla práctica: si aparece
un texto en inglés en el viewer, la clave es el TEXTO EXACTO en inglés → agregarla
al JSON del namespace correcto en `locales/es/` y rebuildear. Los pocos textos
sin capa i18n (p. ej. "Cargando…" de los loaders) están traducidos directo en el
componente.

## Tools custom de fpacs (además del cine fix)

- `extensions/cornerstone/src/tools/PlainLineTool.ts` — herramienta **Línea**:
  línea recta sin caja de medida ni link line (LengthTool con
  `getLinkedTextBoxStyle → visibility:false`). Registrada en
  `initCornerstoneTools` + `initMeasurementService` (mapea como Length) +
  toolgroups del modo longitudinal + botón en el menú de medición.
- **Ángulo** agregado al menú de medición (ya existía la tool; sólo se sumó el
  botón en `modes/longitudinal/src/toolbarButtons.ts`; sigue también en
  "Más herramientas").
- Ícono nuevo `tool-line` (`platform/ui/src/assets/icons/tool-line.svg`,
  registrado en `getIcon.js`).
