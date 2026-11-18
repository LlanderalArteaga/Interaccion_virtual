import { createLabState, setMessage } from './state/labState.js';
import { createLabScene } from './scene/labScene.js';
import { HandTracking } from './xr/handTracking.js';
import { createSessionControls } from './xr/session.js';
import { InteractionController } from './interaction/interactionController.js';
import { createVrPanel } from './ui/vrPanel.js';
import { FeedbackAudio } from './audio/feedback.js';

const state = createLabState();
const elements = {
	preview: document.querySelector('#preview-stage'),
	entrySlot: document.querySelector('#webxr-entry-slot'),
	compatibilityStatus: document.querySelector('#compatibility-status'),
	browserMessage: document.querySelector('#browser-message'),
	loading: document.querySelector('#loading-state')
};

let app;
let handTracking;
let panel;
let interaction;
let audio;
let sessionControls;
let previousHandCount = -1;
let lastHudUpdateAt = 0;
let handCheckTimer = null;
let handTrackingFailureShown = false;

window.addEventListener('error', event => {
	if (event.target instanceof HTMLScriptElement && event.target.type === 'module') {
		showLoadError('No se pudo cargar un módulo JavaScript. Comprueba el CDN y la pestaña Network.');
	}
}, true);
window.addEventListener('unhandledrejection', event => {
	if (event.reason) showLoadError(`No se pudo inicializar el laboratorio: ${event.reason.message ?? event.reason}`);
});

try {
	app = createLabScene(elements.preview);
	state.pieces = app.pieces;
	state.targets = app.targets;
	audio = new FeedbackAudio();
	
	panel = createVrPanel(app.scene, {
		getState: () => state,
		reset: () => interaction.reset(performance.now()),
		exit: () => state.xr.session?.end().catch(error => setMessage(state, `No se pudo finalizar la sesión VR: ${error.message}`, 'error'))
	});
	interaction = new InteractionController(state, panel, audio);
	handTracking = new HandTracking(app.scene, state, side => interaction.onTrackingLost(side));

	sessionControls = createSessionControls(app.renderer, state, elements, {
		onStart: session => {
			audio.resume();
			interaction.startSession(performance.now());
			setMessage(state, 'Sesión inmersiva activa. Muestra tus manos para comenzar.', 'info');
			clearTimeout(handCheckTimer);
			handCheckTimer = setTimeout(() => {
				if (state.xr.session && state.hands.count === 0) {
					setMessage(state, 'Aún no se detectan manos. Activa el seguimiento en Quest y mantén las manos a la vista.', 'error');
				}
			}, 7000);
		},
		onEnd: () => {
			clearTimeout(handCheckTimer);
			interaction.endSession(performance.now());
		}
	});

	elements.loading.classList.add('is-hidden');
	app.renderer.setAnimationLoop(renderFrame);
	window.addEventListener('beforeunload', disposeApp, { once: true });
} catch (error) {
	console.error('Virtual Assembly Lab initialization failed:', error);
	disposeApp();
	showLoadError(`No se pudo iniciar el laboratorio 3D: ${error.message}`);
}

function renderFrame(_time, xrFrame) {
	const now = performance.now();
	const session = app.renderer.xr.getSession();
	if (session && xrFrame) {
		let hands = [];
		try {
			hands = handTracking.update(xrFrame, app.renderer);
			handTrackingFailureShown = false;
		} catch (error) {
			console.error('WebXR hand tracking failed:', error);
			state.hands.left = false;
			state.hands.right = false;
			state.hands.count = 0;
			interaction.onTrackingLost('left');
			interaction.onTrackingLost('right');
			if (!handTrackingFailureShown) {
				setMessage(state, 'No están disponibles los datos de las manos. Comprueba el seguimiento de Quest y vuelve a cargar la página.', 'error', now);
				handTrackingFailureShown = true;
			}
		}
		if (state.hands.count !== previousHandCount) {
			previousHandCount = state.hands.count;
			if (state.phase !== 'complete' && state.ui.kind !== 'error') {
			setMessage(state, state.hands.count ? `${state.hands.count} ${state.hands.count === 1 ? 'mano detectada' : 'manos detectadas'}. Haz pinza sobre una pieza para seleccionarla.` : 'Muestra la mano izquierda o derecha para comenzar.', 'info', now);
			}
		}
		interaction.update(hands, now);
		interaction.advanceTimer(now);
	} else {
		handTracking.update(null, app.renderer);
	}

	const activeCamera = session ? app.renderer.xr.getCamera() : app.camera;
	panel.group.visible = Boolean(session);
	if (session) panel.anchor(activeCamera);
	if (now - lastHudUpdateAt >= 200 || state.ui.revision > 0) {
		panel.update(state, now);
		lastHudUpdateAt = now;
	}
	app.renderer.render(app.scene, app.camera);
}

function showLoadError(message) {
	elements.loading.classList.add('is-hidden');
	elements.browserMessage.textContent = message;
	elements.browserMessage.classList.remove('d-none');
	elements.compatibilityStatus.textContent = 'El laboratorio no terminó de cargar. Revisa Console y Network del navegador.';
}

function disposeApp() {
	clearTimeout(handCheckTimer);
	app?.renderer.setAnimationLoop(null);
	if (app?.renderer.xr.getSession()) app.renderer.xr.getSession().end().catch(() => {});
	sessionControls?.dispose();
	handTracking?.dispose();
	panel?.dispose();
	audio?.dispose();
	app?.disposeLayout();
	if (app?.scene) disposeSceneResources(app.scene);
	app?.renderer.dispose();
}

function disposeSceneResources(scene) {
	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();
	scene.traverse(object => {
		if (object.geometry) geometries.add(object.geometry);
		const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
		for (const material of objectMaterials) {
			if (!material) continue;
			materials.add(material);
			for (const value of Object.values(material)) {
				if (value?.isTexture) textures.add(value);
			}
		}
	});
	for (const texture of textures) texture.dispose();
	for (const material of materials) material.dispose();
	for (const geometry of geometries) geometry.dispose();
}
