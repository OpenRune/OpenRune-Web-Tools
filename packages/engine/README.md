# @openrune/engine

Framework-agnostic model rendering, sprite/animation, and RuneScape data engine. Published standalone so it can be used by the OpenRune Editor app and by other web tools independently.

## Develop

From the repo root (npm workspaces):

```
npm install
npm run dev -w @openrune/engine   # watch build
npm run build -w @openrune/engine # one-off build
```

Consume it locally from the editor app (or any other workspace package) by adding it as a dependency:

```
"@openrune/engine": "*"
```

npm workspaces links the local package automatically — no publish needed during development.

## Publish

```
npm run build -w @openrune/engine
npm publish -w @openrune/engine
```

Requires access to the `@openrune` npm org.
