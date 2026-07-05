# Domain: portfolio-builder

## Overview

Sistema de clasificación de portafolios de inversión para clientes de SABBI.
Los inversionistas deben categorizar todos sus productos de inversión en 6 categorías
con sus respectivas subcategorías, asignando montos y composiciones porcentuales para
generar un portafolio final consolidado que sume 100%.

## Current State (Baseline — Excel manual)

Actualmente el proceso se realiza mediante un archivo Excel con múltiples hojas:

### Categorías del portafolio

| #  | Categoría             | Subcategorías                                                                 |
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
- Categoría principal
- Composición porcentual por asset class (puede distribuirse en múltiples categorías)
- Fuente (SABBI, Otros)

### Hoja de portafolio final

- Consolidación de todas las hojas por categoría
- Porcentaje de cada categoría y subcategoría sobre el total
- Debe sumar exactamente 100%
- Incluye retorno último año y portafolio deseado (target allocation)

## Pain Points

1. El inversionista debe clasificar manualmente cada producto en la hoja correcta
2. Productos multi-categoría requieren dividir montos entre hojas diferentes
3. No hay validación automática de que la suma sea 100%
4. El proceso es propenso a errores y consume tiempo
5. No hay forma de importar datos desde estados de cuenta existentes
