const swaggerUi = require("swagger-ui-express");
const { openApiDocument } = require("./openapi");

/**
 * Mount Swagger UI at /api-docs and raw OpenAPI JSON at /api-docs.json
 */
function setupSwagger(app) {
  app.get("/api-docs.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Relux Hub API Docs",
      explorer: true,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "none",
        filter: true,
        tryItOutEnabled: true,
      },
    }),
  );
}

module.exports = { setupSwagger, openApiDocument };
