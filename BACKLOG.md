# Backlog — Observatorio de Mortalidad del Perú

## Verificación suicidios / homicidios (`suicidios-homicidios.html`)

Hecho (20-nov-2026): página publicada; contraste con OMS (GHE 2021 vs GHE 2023), Banco Mundial,
SINADEF, CEIC-INEI, notas del MINSA y literatura; versión por años; OG propia.

Hecho (20-nov, tarde): sección «Cómo se registra» (circuito peruano con la Directiva 353-MINSA/OGTI-2024,
dos definiciones oficiales, tabla comparativa de 11 países con calidad OMS).

Pendiente:
- [ ] Verificar si se aprobó el documento normativo de prevención del suicidio que ordena el DS 011-2025-SA
      (podría asignar la estadística a alguna institución).
- [ ] Confirmar si el protocolo de necropsia del IML registra el tipo de muerte y qué base remite el Perú a la OMS.
- [ ] La tabla por país está transcrita a mano en el HTML: pasarla al JSON con sus URLs por celda.
- [ ] Solicitudes de acceso a la información: Ministerio Público/IML (necropsias por tipo de muerte,
      año y distrito fiscal) y PNP (ocurrencias de suicidio en SIDPOL). Es la única vía para un conteo
      independiente del certificado.
- [ ] Cifra del GBD/IHME específica para el Perú (autolesión y violencia interpersonal): requiere
      cuenta en vizhub.healthdata.org/gbd-results.
- [ ] Origen de la tasa 2023 del MINSA (2.8 por 100 mil ≈ 944 muertes) y de la serie 976/949/1,097
      citada en prensa: no identificado.
- [ ] Revisar el tablero REUNIS «Defunciones registradas» (Tableau) por si desagrega suicidio.
- [ ] Volver a bajar la microdata SINADEF (el contraste usa el corte del 23-sep-2026).
- [ ] Cuando el Banco Mundial incorpore GHE 2023, la «edición anterior» dejará de salir de su API:
      congelar una copia de la serie GHE 2021 en el repo.
- [ ] Probar en teléfono real (tooltips y toques); la franja de sombra del drawer en `index.html`.
- [ ] Tipografías Fraunces/Inter en `assets/fonts/` para que las imágenes OG usen las de la web.
- [ ] Cruce con depresión: falta ubicar el repo/fuente.
