import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Swagger UI desde CDN.
 *
 * En serverless (Vercel) los assets estáticos de swagger-ui-dist no llegan al
 * bundle de la función (dan 404: "Cannot GET /docs/swagger-ui-bundle.js"),
 * lo que deja la página en blanco. Solución: desactivar el UI embebido de
 * Nest (ui: false — el spec en /docs-json sigue publicado) y servir nosotros
 * mismos el HTML de /docs cargando la UI desde jsDelivr.
 */
const SWAGGER_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.25.2';

const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Parental Coordination API</title>
  <link rel="stylesheet" href="${SWAGGER_CDN}/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar .download-url-wrapper { display: none }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_CDN}/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/docs-json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'StandaloneLayout',
        docExpansion: 'none',
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>`;

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  const document = new DocumentBuilder()
    .setTitle('Parental Coordination API')
    .setDescription('Sistema de Coordinación Parental — Backend')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  // Spec OpenAPI en /docs-json (y /docs-yaml), sin el UI estático de Nest.
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, document), {
    ui: false,
  });

  // UI servida por nosotros desde CDN — funciona en Vercel y en local.
  app.getHttpAdapter().get('/docs', (_req, res) => {
    res.type('text/html').send(swaggerHtml);
  });
}
