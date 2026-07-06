# Proposal: sabbi-portfolio-agent

## Summary

Reemplazar el flujo manual de clasificación en Excel con un agente conversacional
impulsado por Claude (Anthropic) que permite a los inversionistas construir su
portafolio de forma guiada, extrayendo productos de inversión desde múltiples
fuentes (PDFs, capturas de pantalla, factsheets, links, texto libre) y
presentándolos como cards interactivos editables.

## Motivation

Los inversionistas de SABBI invierten entre 30-60 minutos clasificando manualmente
sus productos en un Excel de múltiples hojas. El proceso es confuso para productos
multi-categoría (ej: un fondo con 80% mercados privados y 20% públicos) y propenso
a errores de clasificación y cálculo.

## Scope

### In scope

- Agente conversacional con interfaz split-screen (chat + portafolio)
- Procesamiento de documentos: PDFs, imágenes/screenshots, factsheets, links
- Extracción automática de productos con nombre, proveedor, monto y clasificación
- Cards interactivos por producto con composición por asset class
- Edición vía modal de dos columnas (datos + composición porcentual)
- Eliminación con confirmación inline en la card
- Agregar productos manualmente vía modal
- Filtrado por las 6 categorías del portafolio SABBI
- Vista de resumen final con donut chart y tabla consolidada
- Exportación a Excel (formato compatible con el template actual)
- Envío directo a SABBI

### Out of scope (v1)

- Recomendaciones de inversión o rebalanceo automático
- Integración directa con brokers o plataformas de inversión
- Histórico de portafolios o versioning
- Multi-usuario / colaboración en tiempo real
- Autenticación y gestión de sesiones (se asume single-user por sesión)

## Success Criteria

1. Un inversionista puede construir su portafolio completo en <10 minutos
2. La extracción de documentos identifica correctamente >90% de los productos
3. El portafolio final generado es 100% compatible con el formato Excel existente
4. Zero errores de cálculo en la distribución porcentual

## Stakeholders

- Inversionistas SABBI (usuarios finales)
- Equipo de asesores SABBI (reciben el portafolio final)
- Equipo de desarrollo SABBI