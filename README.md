# 3.2 Interacción virtual

Laboratorio universitario inmersivo para clasificar veinte cuerpos geométricos en cuatro recipientes usando seguimiento real de manos, pinza y física de cuerpos rígidos.

**Autor:** Axel Llanderal Arteaga  
**Tipo de entrega:** sitio estático, sin backend ni proceso de compilación.

> La vista previa en computadora solo sirve para inspeccionar la escena y la gravedad. El seguimiento genuino de manos y la sesión `immersive-vr` deben validarse en Meta Quest Browser.

## Tecnologías

- Three.js `0.187.0`, núcleo y addons desde jsDelivr.
- cannon-es `0.20.0` para gravedad, colisiones, fricción, restitución y cuerpos dinámicos, estáticos y cinemáticos.
- Bootstrap `5.3.9` para la portada HTML.
- JavaScript ES modules, HTML5, CSS3 y WebXR Device API.

Las versiones están fijadas en el import map de `index.html`. El navegador resuelve los nombres `three`, `three/addons/` y `cannon-es` a esas URL antes de cargar `src/main.js`; los imports del proyecto usan rutas relativas. El import map está antes del módulo principal.

## Ejecutar localmente

1. Abre esta carpeta en Visual Studio Code.
2. Inicia `index.html` con Live Server.
3. Revisa la portada y la vista previa; en Console y Network comprueba errores de imports, CDN, recursos o CORS.

Para usar WebXR, abre el sitio desde un origen seguro. `localhost` en la computadora no es `localhost` en el visor; la validación obligatoria de manos se realiza en Quest Browser con la URL HTTPS publicada y el seguimiento de manos activado.

## Publicar en GitHub Pages

1. Sube los archivos de esta carpeta a la rama `main` del repositorio.
2. En GitHub abre **Settings → Pages**.
3. Selecciona **Deploy from a branch**, rama `main` y carpeta `/(root)`.
4. Espera a que GitHub publique y abre la URL HTTPS del repositorio.
5. En Quest Browser valida imports, sesión VR, ambas manos, física, clasificación, reinicio y salida.

Los recursos del proyecto usan rutas relativas (`./src/...`, `./assets/...`) para funcionar bajo la ruta de subdirectorio que usa GitHub Pages. URL de Pages compartida durante el desarrollo: <https://llanderalarteaga.github.io/Interaccion_virtual/>. La versión final debe volver a publicarse y comprobarse después de los últimos cambios locales.

## Controles y reglas

- Entra a VR y muestra una o ambas manos.
- Haz pinza sobre **COMENZAR** en el panel 3D. El cronómetro empieza en ese momento.
- Apunta con el rayo, mantén la pinza para mover una figura y suéltala dentro del recipiente de su categoría.
- La figura solo cuenta cuando queda estable dentro del recipiente correcto. No se teletransporta al destino; queda físicamente en su lugar y bloqueada.
- Un depósito estable en un recipiente equivocado cuenta como un intento y un error. Una caída fuera de los recipientes muestra aviso, pero no cuenta como intento de clasificación.
- Precisión = piezas correctamente clasificadas ÷ intentos confirmados × 100. Si no hay intentos, se muestra 0 %.
- Cada tiempo de recipiente mide desde **COMENZAR** hasta que se valida la quinta pieza de esa categoría. Antes muestra “Pendiente”.
- Salir de VR pausa el cronómetro. Al volver, usa **REANUDAR**. **REINICIAR** devuelve las piezas a las mesas, limpia el marcador y permite comenzar otra partida.
- El botón **Reiniciar escenario** de la portada también restaura la escena antes o después de entrar a VR.
- Solo una figura puede estar sujeta por vez. La selección usa rayo y pinza de la mano; al soltar vuelve a ser un cuerpo dinámico con una velocidad de lanzamiento limitada.

## Arquitectura

La ambientación es un laboratorio universitario de prototipado generado con geometrías y materiales de Three.js: paredes verde pizarra, piso de taller, ventanales estilizados y luminarias. Es completamente opaca y no usa cámara ni passthrough. La decoración no agrega cuerpos al motor físico, así que el tamaño del espacio y las colisiones existentes se conservan.

| Ruta | Responsabilidad |
|---|---|
| `index.html`, `assets/css/site.css` | Portada, Bootstrap, accesibilidad y estado de compatibilidad |
| `src/main.js` | Inicio, ciclo de render y coordinación de módulos |
| `src/scene/labScene.js` | Escena, cuatro mesas, veinte piezas, cuatro recipientes y reinicio aleatorio |
| `src/physics/physicsWorld.js` | Mundo cannon-es, paso físico de 1/60 s, colisionadores y sincronización mesh/cuerpo |
| `src/xr/session.js`, `src/xr/handTracking.js` | Sesión immersive-vr, articulaciones, rayos y detección de pinza |
| `src/interaction/interactionController.js` | Sujeción cinemática, lanzamiento, reposo y validación de recipiente |
| `src/state/labState.js` | Estado compartido, cronómetro, progreso y métricas |
| `src/ui/vrPanel.js`, `src/ui/canvasUi.js` | HUD 3D, controles, marcador y resumen de victoria |
| `src/audio/feedback.js`, `src/effects/celebration.js` | Tonos sintetizados localmente y confeti 3D |

Cada pieza tiene un ID único y relaciona categoría, malla, cuerpo, mesa de origen, recipiente asignado y estado. El contador se protege con los indicadores `classified`/`counted`; la validación sale inmediatamente si la pieza ya fue clasificada. Así un mismo contacto no puede sumar dos veces.

Las cuatro clases son cubo, esfera, pirámide cuadrada y prisma hexagonal; hay cinco de cada una, repartidas en cuatro mesas con cinco piezas por mesa. Al reiniciar se barajan las piezas, las ranuras y la orientación inicial. Los recipientes son ensamblajes físicos de base y paredes separadas, sin tapa.

Los estados de las piezas son `available`, `held`, `released`, `stabilizing`, `classified`, `error` y `recoverable`. Las caídas al piso muestran un marcador y se pueden volver a sujetar.

### Cambiar las figuras

Edita `CATEGORY_SPECS` en `src/scene/labScene.js`: cada definición incluye `id`, nombre, color, geometría visual, forma de cannon-es y dimensiones aproximadas. Añadir una clase también requiere agregar su forma y colisionador en `src/physics/physicsWorld.js`, crear la posición/color del recipiente en `createBins`, actualizar la lista del HUD en `src/ui/canvasUi.js` y el conjunto `CATEGORY_IDS` en `src/state/labState.js`. Mantén los mismos IDs en pieza, recipiente y marcador. El número por clase se controla en el bucle que crea piezas (`index < 5`); las cuatro mesas se definen en `STATIONS` y reciben cinco ranuras de `OBJECT_SLOTS` cada una.

## Decisiones y límites de física

- Gravedad: `-9.82 m/s²`; paso fijo: `1/60 s`, con máximo de cinco subpasos por actualización.
- Los cuerpos se duermen al estabilizarse. El agarre cambia el cuerpo a cinemático; la liberación restaura masa y dinámica. La velocidad de lanzamiento está limitada para reducir penetraciones y sacudidas.
- Las pirámides usan un colisionador convexo aproximado. Tienen un umbral de estabilización ligeramente distinto por su balanceo. La validación usa posición, AABB y tolerancias; las pruebas de pirámides apiladas/inclinadas deben hacerse en Quest.
- Durante el agarre hay una corrección específica para mantener la figura sobre las mesas. No equivale a detección continua de colisión para todas las superficies a cualquier velocidad; hay que revisar lanzamientos rápidos y contactos con bordes.
- No se han medido FPS en Meta Quest 3. El rendimiento debe comprobarse en el visor real.

## Assets, créditos y licencias

Las piezas, mesas, recipientes, HUD, manos y confeti se generan con geometrías/texturas en código; no se descargan modelos ni imágenes. Los tonos de confirmación se sintetizan con Web Audio. El favicon es un SVG local.

- Three.js, licencia MIT: <https://github.com/mrdoob/three.js>
- cannon-es, licencia MIT: <https://github.com/pmndrs/cannon-es>
- Bootstrap, licencia MIT: <https://github.com/twbs/bootstrap>
- Referencia de interacción VR: <https://threejs.org/examples/?q=vr#webxr_vr_handinput_pointerdrag>
- Documentación de manos WebXR de Meta: <https://developers.meta.com/vr/documentation/web/webxr-hands/>
- Documentación cannon-es: <https://pmndrs.github.io/cannon-es/>

La práctica amplía el proyecto 3.1 del alumno; no reproduce el ejemplo de Three.js como diseño final.

## Pruebas y evidencia

La matriz detallada está en [`docs/matriz-pruebas.md`](docs/matriz-pruebas.md). El código inspeccionado no sustituye las pruebas reales: toda celda de resultado observado/evidencia debe completarse con ejecución en computadora o Meta Quest según corresponda. Estado actual de publicación y visor: pendiente de volver a validar después de los últimos cambios locales.

Para cerrar la entrega, adjunta:

- URL pública del repositorio GitHub.
- URL HTTPS de GitHub Pages después del último despliegue.
- URL de video en Meta Quest 3 que muestre inicio, ambas manos, depósitos correctos y erróneos, reinicio y victoria.
- Conclusiones del alumno y dos problemas reales corregidos durante el desarrollo.
