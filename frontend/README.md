# Frontend

React 19 + Vite + TypeScript + Tailwind CSS 4.

```bash
npm install
npm run dev        # http://localhost:5173 con proxy /api hacia http://127.0.0.1:8000
npm run typecheck
npm run build      # genera dist/
```

## Notas

- Todas las peticiones que modifican datos envían la cabecera `X-Requested-With: HelpDeskCasma` (protección CSRF del backend). El cliente de `src/lib/api.ts` ya lo hace.
- La sesión viaja en cookies `HttpOnly`; no hay tokens en `localStorage`.
- El portal de oficina usa la tipografía Atkinson Hyperlegible, diseñada para baja visión, y controles de al menos 48 px.
- La cámara y el dictado por voz necesitan HTTPS (o `localhost`) para funcionar en el navegador.
