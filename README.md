# Whatbenny con Biometría y WebSockets

Esta es una aplicación de chat moderna construida con **React, Node.js (Express), Socket.io y Tailwind CSS**.

## Características principales:
- **Biometría (WebAuthn):** Inicia sesión con Face ID o Huella dactilar.
- **Tiempo Real:** Mensajería instantánea con WebSockets.
- **Notificaciones:** Avisos nativos de nuevos mensajes.
- **Diseño Oscuro:** Interfaz elegante inspirada en aplicaciones de chat premium.

## Instalación Local:
1. Clona el repo.
2. Ejecuta `npm install`.
3. Crea un archivo `.env` basado en `.env.example`.
4. Ejecuta `npm run dev`.

## Despliegue en Render:
1. Crea un **Web Service**.
2. Conecta tu repo de GitHub.
3. Build Command: `npm install && npm run build`
4. Start Command: `npm start`
5. Configura las variables de entorno: `JWT_SECRET` y `APP_URL`.
