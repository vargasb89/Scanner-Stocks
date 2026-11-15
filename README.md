# Scanner-Stocks
Scanner

### Módulo Short Squeeze

Vista separada en `/short-squeeze`. El radar inicial busca candidatos por precio
en el universo de Massive; el detalle por ticker incorpora el cálculo D1/D2 y
las verificaciones manuales de la estrategia. No genera ni ejecuta órdenes.
Ver [criterios, cobertura y limitaciones](docs/short-squeeze.md). Ejecuta
`npm test` para verificar los casos con datos sintéticos.
