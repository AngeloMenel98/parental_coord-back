import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Swagger UI served from CDN.
 *
 * On serverless (Vercel) the bundled swagger-ui-dist static assets are not
 * exposed (they 404), which renders a blank page. Loading the UI from the
 * jsDelivr CDN fixes that; the OpenAPI spec itself is still served by Nest
 * at /docs-json.
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
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, document), {
    customHtml: swaggerHtml,
  });
}
