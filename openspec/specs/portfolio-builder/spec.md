# Domain: portfolio-builder

## Overview

Sistema de clasificación de portafolios de inversión para clientes de SABBI.
Los inversionistas clasifican todos sus productos de inversión en 6 clases de activo
con sus respectivas subcategorías. Cada producto tiene un array `asset_class`
de `[{name, percentage}]` que suma 100%, permitiendo productos multi-clase cuyo monto
se distribuye proporcionalmente. El portafolio final consolidado suma 100%.

## Current State (Baseline — Excel manual)

Actualmente el proceso se realiza mediante un archivo Excel con múltiples hojas:

### Clases de activo del portafolio

| #  | Clase de activo       | Subcategorías                                                                 |
|----|----------------------|-------------------------------------------------------------------------------|
| 1  | Inversiones directas | Accionariado, RE Perú (residencial, comercial, terrenos), RE Extranjero       |
| 2  | Mercados privados    | Deuda privada, Private equity, Venture capital, Real estate, Hedge funds, Infraestructura |
| 3  | Club deals           | Real estate, Deuda privada, Otros                                              |
| 4  | Mercados públicos    | Renta variable (US, Intl, EM), Renta fija (Gov, Corp, HY, EM)                 |
| 5  | Otros                | Cripto, Commodities                                                            |
| 6  | Cash y equivalentes  | Depósitos a plazo, Money market, Cuentas corrientes                           |

### Atributos por producto de inversión

- Nombre del producto
- Proveedor / administrador
- Monto invertido (USD)
- Clase de activo: array `[{name, percentage}]` sumando 100% (soporta multi-clase)
- Underlying: composición porcentual por subyacente
- Fuente (SABBI, Otros)

### Hoja de portafolio final

- Consolidación de todas las hojas por clase de activo
- Porcentaje de cada clase y subcategoría sobre el total (splitting proporcional)
- Debe sumar exactamente 100%
- Incluye retorno último año y portafolio deseado (target allocation)

## Pain Points

1. El inversionista debe clasificar manualmente cada producto en la hoja correcta
2. Productos multi-clase requieren dividir montos entre hojas diferentes
3. No hay validación automática de que la suma sea 100%
4. El proceso es propenso a errores y consume tiempo
5. No hay forma de importar datos desde estados de cuenta existentes
