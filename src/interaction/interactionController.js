import * as THREE from 'three';
import { CANNON } from '../physics/physicsWorld.js';
import { LAB_CONFIG, setMessage } from '../state/labState.js';

const THROW_SPEED_LIMIT = 4.2;

export class InteractionController {
	constructor(state, panel, audio, physicsWorld, resetLayout) {
		this.state = state;
		this.panel = panel;
		this.audio = audio;
		this.physicsWorld = physicsWorld;
		this.resetLayout = resetLayout;
		this.raycaster = new THREE.Raycaster();
		this.raycaster.near = 0;
		this.raycaster.far = LAB_CONFIG.maxRayDistance;
		this.grabOffset = new THREE.Vector3();
		this.grabPoint = new THREE.Vector3();
		this.nextPosition = new THREE.Vector3();
		this.previousDragPosition = new THREE.Vector3();
		this.frameVelocity = new THREE.Vector3();
		this.dragVelocity = new THREE.Vector3();
		this.lastDragTime = 0;
		this.hoveredPieceId = null;
	}

	update(handSnapshots, now) {
	let hoveredControl = null;
	let hoveredPiece = null;
	let actionHandled = false;

		for (const hand of handSnapshots) {
			if (!hand.tracked) continue;
			if (this.state.selectedBy === hand.side) {
				if (hand.rayValid && hand.pinching) this.#moveSelected(hand, now);
				if (hand.pinchEnded) this.#releaseSelected(now);
				continue;
			}
			if (!hand.rayValid) continue;
			this.raycaster.ray.copy(hand.ray);
			const controlHit = this.raycaster.intersectObjects(this.panel.controls, false)[0];
			if (controlHit) {
				const control = controlHit.object;
				hoveredControl ??= control.userData.controlId;
				if (hand.pinchStarted && !actionHandled) {
					control.userData.action?.();
					actionHandled = true;
				}
				continue;
			}

			const pieceHit = this.#findPieceHit();
			if (!pieceHit) continue;
			hoveredPiece ??= pieceHit.piece.id;
			if (hand.pinchStarted && this.state.selectedPieceId === null && !pieceHit.piece.classified) {
				this.#beginGrab(pieceHit.piece, hand, pieceHit.hit, now);
			}
			if (this.state.selectedBy === hand.side && hand.pinching) this.#moveSelected(hand, now);
			if (this.state.selectedBy === hand.side && hand.pinchEnded) this.#releaseSelected(now);
		}
		this.#setHoverState(hoveredControl, hoveredPiece);
	}

	startSession(now) {
		this.state.phase = this.state.phase === 'complete' ? 'complete' : 'active';
		if (this.state.phase !== 'complete') {
			this.state.timer.running = true;
			this.state.timer.lastTick = now;
			setMessage(this.state, this.state.hands.count ? 'Haz pinza para tomar una figura; al soltarla, la gravedad y las colisiones actúan.' : 'Muestra tus manos para comenzar.', 'info', now);
		}
	}

	endSession(now) {
		this.#pauseTimer(now);
		this.#releaseForTrackingLoss();
		if (this.state.phase !== 'complete') {
			this.state.phase = 'active';
			setMessage(this.state, 'Sesión pausada. Vuelve a entrar a VR para continuar.', 'info', now);
		}
		this.#setHoverState(null, null);
	}

	onTrackingLost(side) {
		if (this.state.selectedBy !== side) return;
		this.#releaseForTrackingLoss();
		setMessage(this.state, 'Se perdió el seguimiento. La figura se soltó y continúa bajo gravedad; puedes volver a tomarla.', 'error');
	}

	reset(now = performance.now()) {
		this.#releaseForTrackingLoss();
		this.resetLayout();
		this.state.phase = this.state.xr.session ? 'active' : 'ready';
		this.state.timer.elapsedMs = 0;
		this.state.timer.running = Boolean(this.state.xr.session);
		this.state.timer.lastTick = now;
		this.state.ui.errorTargetId = null;
		this.state.ui.errorPieceId = null;
		this.state.ui.errorUntil = 0;
		setMessage(this.state, this.state.xr.session ? 'Escenario reiniciado. Las veinte piezas se redistribuyeron.' : 'Escenario reiniciado. Entra a VR para comenzar.', 'info', now);
		this.#setHoverState(null, null);
	}

	advanceTimer(now) {
		if (!this.state.timer.running) return;
		const delta = Math.max(0, now - this.state.timer.lastTick);
		this.state.timer.elapsedMs += delta;
		this.state.timer.lastTick = now;
	}

	#findPieceHit() {
		let closest = null;
		for (const piece of this.state.pieces) {
			if (piece.classified) continue;
			const hit = this.raycaster.intersectObject(piece.mesh, false)[0];
			if (hit && (!closest || hit.distance < closest.hit.distance)) closest = { piece, hit };
		}
		return closest;
	}

	#beginGrab(piece, hand, hit, now) {
		if (piece.classified || this.state.selectedPieceId !== null) return;
		this.state.selectedPieceId = piece.id;
		this.state.selectedBy = hand.side;
		piece.status = 'held';
		this.#setBodyType(piece.body, CANNON.Body.KINEMATIC, 0);
		piece.body.velocity.set(0, 0, 0);
		piece.body.angularVelocity.set(0, 0, 0);
		piece.body.wakeUp();
		hand.ray.at(THREE.MathUtils.clamp(hit.distance, LAB_CONFIG.grabDistanceMin, LAB_CONFIG.grabDistanceMax), this.grabPoint);
		this.state.dragDistance = this.grabPoint.distanceTo(hand.ray.origin);
		this.grabOffset.set(piece.body.position.x, piece.body.position.y, piece.body.position.z).sub(this.grabPoint);
		this.previousDragPosition.set(piece.body.position.x, piece.body.position.y, piece.body.position.z);
		this.dragVelocity.set(0, 0, 0);
		this.lastDragTime = now;
		piece.material.emissive.set('#718d62');
		setMessage(this.state, `${piece.name} sujeta. Muévela y suéltala para probar la gravedad y el rebote.`, 'info', now);
	}

	#moveSelected(hand, now) {
		const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
		if (!piece || piece.status !== 'held') return;
		hand.ray.at(this.state.dragDistance, this.nextPosition).add(this.grabOffset);
		this.nextPosition.x = THREE.MathUtils.clamp(this.nextPosition.x, -2.05, 2.05);
		this.nextPosition.y = THREE.MathUtils.clamp(this.nextPosition.y, 0.12, 2.25);
		this.nextPosition.z = THREE.MathUtils.clamp(this.nextPosition.z, -2.05, 2.05);
		const deltaSeconds = (now - this.lastDragTime) / 1000;
		if (deltaSeconds > 0 && deltaSeconds <= 0.1) {
			this.frameVelocity.copy(this.nextPosition).sub(this.previousDragPosition)
				.multiplyScalar(1 / deltaSeconds)
				.clampLength(0, THROW_SPEED_LIMIT);
			this.dragVelocity.lerp(this.frameVelocity, 0.42).clampLength(0, THROW_SPEED_LIMIT);
		} else {
			this.dragVelocity.set(0, 0, 0);
		}
		piece.body.position.set(this.nextPosition.x, this.nextPosition.y, this.nextPosition.z);
		piece.body.velocity.set(this.dragVelocity.x, this.dragVelocity.y, this.dragVelocity.z);
		piece.body.aabbNeedsUpdate = true;
		this.previousDragPosition.copy(this.nextPosition);
		this.lastDragTime = now;
	}

	#releaseSelected(now) {
		const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
		this.state.selectedPieceId = null;
		this.state.selectedBy = null;
		if (!piece || piece.classified) return;
		this.#setBodyType(piece.body, CANNON.Body.DYNAMIC, piece.massKg);
		piece.body.velocity.set(this.dragVelocity.x, this.dragVelocity.y, this.dragVelocity.z);
		piece.body.angularVelocity.set(0, 0, 0);
		piece.body.aabbNeedsUpdate = true;
		piece.body.wakeUp();
		piece.status = 'released';
		piece.material.emissive.set('#000000');
		setMessage(this.state, 'Figura liberada: rebota y se estabiliza por colisiones físicas.', 'info', now);
	}

	#releaseForTrackingLoss() {
		const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
		if (piece && !piece.classified) {
			this.#setBodyType(piece.body, CANNON.Body.DYNAMIC, piece.massKg);
			piece.body.velocity.set(this.dragVelocity.x, this.dragVelocity.y, this.dragVelocity.z);
			piece.body.angularVelocity.set(0, 0, 0);
			piece.body.aabbNeedsUpdate = true;
			piece.body.wakeUp();
			piece.status = 'released';
			piece.material.emissive.set('#000000');
		}
		this.state.selectedPieceId = null;
		this.state.selectedBy = null;
	}

	#setBodyType(body, type, mass) {
		body.type = type;
		body.mass = mass;
		body.updateMassProperties();
		body.aabbNeedsUpdate = true;
		this.physicsWorld.broadphase.dirty = true;
	}

	#pauseTimer(now) {
		this.advanceTimer(now);
		this.state.timer.running = false;
	}

	#setHoverState(controlId, pieceId) {
		this.panel.setHovered(controlId);
		if (this.hoveredPieceId && this.hoveredPieceId !== this.state.selectedPieceId) {
			const previous = this.state.pieces.find(item => item.id === this.hoveredPieceId);
			if (previous && !previous.classified) previous.material.emissive.set('#000000');
		}
		if (pieceId && pieceId !== this.state.selectedPieceId) {
			const current = this.state.pieces.find(item => item.id === pieceId);
			if (current && !current.classified) current.material.emissive.set('#384b42');
		}
		this.hoveredPieceId = pieceId;
	}
}
