import * as THREE from 'three';
import { validateDrop } from '../lab/assemblyRules.js';
import { LAB_CONFIG, formatTime, getProgress, setMessage, updateMessageExpiry } from '../state/labState.js';
import { setTargetStatus } from '../scene/labScene.js';

export class InteractionController {
	constructor(state, panel, audio) {
		this.state = state;
		this.panel = panel;
		this.audio = audio;
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
		this.lastPhysicsTime = null;
		this.hoveredPieceId = null;
	}

	update(handSnapshots, now) {
		updateMessageExpiry(this.state, now);
		this.#expireTargetFeedback(now);
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
			if (hand.pinchStarted && this.state.selectedPieceId === null && pieceHit.piece.status === 'available') {
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
			setMessage(this.state, this.state.hands.count ? 'Haz pinza sobre una pieza y colócala en su destino.' : 'Muestra tus manos para comenzar.', 'info', now);
		}
	}

	endSession(now) {
		this.#pauseTimer(now);
		this.#clearTargetError();
		if (this.state.selectedPieceId) {
			const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
			if (piece && (piece.status === 'selected' || piece.status === 'moving')) {
				piece.status = 'available';
				this.#startPhysics(piece);
			}
			piece?.material.emissive.set('#000000');
		}
		this.state.selectedPieceId = null;
		this.state.selectedBy = null;
		if (this.state.phase !== 'complete') {
			this.state.phase = 'active';
			setMessage(this.state, 'Sesión pausada. Vuelve a entrar a VR para continuar.', 'info', now);
		}
		this.#setHoverState(null, null);
	}

	onTrackingLost(side) {
		if (this.state.selectedBy !== side) return;
		const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
		if (piece && (piece.status === 'selected' || piece.status === 'moving')) {
			piece.status = 'available';
			this.#startPhysics(piece);
		}
		piece?.material.emissive.set('#000000');
		this.state.selectedPieceId = null;
		this.state.selectedBy = null;
		setMessage(this.state, 'Se perdió el seguimiento de la mano. La pieza se soltó de forma segura; inténtalo de nuevo.', 'error');
	}

	reset(now = performance.now()) {
		this.state.selectedPieceId = null;
		this.state.selectedBy = null;
		for (const target of this.state.targets) setTargetStatus(target, 'available');
		for (const piece of this.state.pieces) {
			piece.status = 'available';
			piece.root.position.copy(piece.startPosition);
			piece.root.quaternion.copy(piece.startQuaternion);
			piece.velocity.set(0, 0, 0);
			piece.physicsActive = false;
			piece.material.color.set(piece.color);
			piece.material.emissive.set('#000000');
		}
		this.state.phase = this.state.xr.session ? 'active' : 'ready';
		this.state.timer.elapsedMs = 0;
		this.state.timer.running = Boolean(this.state.xr.session);
		this.state.timer.lastTick = now;
		this.state.ui.errorTargetId = null;
		this.state.ui.errorPieceId = null;
		this.state.ui.errorUntil = 0;
		setMessage(this.state, this.state.xr.session ? 'Reto reiniciado. Coloca cada pieza en su destino.' : 'Reto reiniciado. Entra a VR para comenzar.', 'info', now);
		this.#setHoverState(null, null);
	}

	advanceTimer(now) {
		if (!this.state.timer.running) return;
		const delta = Math.max(0, now - this.state.timer.lastTick);
		this.state.timer.elapsedMs += delta;
		this.state.timer.lastTick = now;
	}

	advancePhysics(now) {
		const deltaSeconds = this.lastPhysicsTime === null
			? 0
			: THREE.MathUtils.clamp((now - this.lastPhysicsTime) / 1000, 0, 0.05);
		this.lastPhysicsTime = now;
		if (deltaSeconds === 0) return;

		const table = LAB_CONFIG.tableBounds;
		for (const piece of this.state.pieces) {
			if (!piece.physicsActive) continue;
			piece.velocity.y -= LAB_CONFIG.gravity * deltaSeconds;
			piece.root.position.addScaledVector(piece.velocity, deltaSeconds);

			const position = piece.root.position;
			const overTable = position.x >= table.minX && position.x <= table.maxX
				&& position.z >= table.minZ && position.z <= table.maxZ;
			const surfaceY = overTable ? piece.restCenterY : piece.floorCenterY;
			if (position.y <= surfaceY) {
				position.y = surfaceY;
				piece.velocity.y = Math.max(0, -piece.velocity.y * LAB_CONFIG.impactBounce);
				const friction = Math.exp(-LAB_CONFIG.surfaceFriction * deltaSeconds);
				piece.velocity.x *= friction;
				piece.velocity.z *= friction;
				if (piece.velocity.y < 0.12) piece.velocity.y = 0;
				if (piece.velocity.length() < 0.06) {
					piece.velocity.set(0, 0, 0);
					piece.physicsActive = false;
				}
			}
		}
	}

	#findPieceHit() {
		let closest = null;
		for (const piece of this.state.pieces) {
			if (piece.status === 'placed') continue;
			const hit = this.raycaster.intersectObject(piece.mesh, false)[0];
			if (hit && (!closest || hit.distance < closest.hit.distance)) closest = { piece, hit };
		}
		return closest;
	}

	#beginGrab(piece, hand, hit, now) {
		if (piece.status === 'placed' || this.state.selectedPieceId !== null) return;
		this.state.selectedPieceId = piece.id;
		this.state.selectedBy = hand.side;
		piece.status = 'selected';
		piece.physicsActive = false;
		piece.velocity.set(0, 0, 0);
		piece.root.updateWorldMatrix(true, false);
		this.state.dragDistance = THREE.MathUtils.clamp(hit.distance, LAB_CONFIG.grabDistanceMin, LAB_CONFIG.grabDistanceMax);
		hand.ray.at(this.state.dragDistance, this.grabPoint);
		this.grabOffset.copy(piece.root.position).sub(this.grabPoint);
		this.previousDragPosition.copy(piece.root.position);
		this.dragVelocity.set(0, 0, 0);
		this.lastDragTime = now;
		piece.material.emissive.set('#718d62');
		this.#clearTargetError();
		setMessage(this.state, `Pieza ${piece.name} seleccionada. Mueve la mano y suéltala cerca de su destino.`, 'info');
	}

	#moveSelected(hand, now) {
		const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
		if (!piece || (piece.status !== 'selected' && piece.status !== 'moving')) return;
		hand.ray.at(this.#getGrabDistance(), this.nextPosition).add(this.grabOffset);
		const bounds = LAB_CONFIG.moveBounds;
		this.nextPosition.x = THREE.MathUtils.clamp(this.nextPosition.x, bounds.minX, bounds.maxX);
		this.nextPosition.y = THREE.MathUtils.clamp(this.nextPosition.y, bounds.minY, bounds.maxY);
		this.nextPosition.z = THREE.MathUtils.clamp(this.nextPosition.z, bounds.minZ, bounds.maxZ);
		const deltaSeconds = (now - this.lastDragTime) / 1000;
		if (deltaSeconds > 0 && deltaSeconds <= 0.1) {
			this.frameVelocity.copy(this.nextPosition).sub(this.previousDragPosition)
				.multiplyScalar(1 / deltaSeconds)
				.clampLength(0, LAB_CONFIG.maxThrowSpeed);
			this.dragVelocity.lerp(this.frameVelocity, LAB_CONFIG.throwVelocitySmoothing)
				.clampLength(0, LAB_CONFIG.maxThrowSpeed);
		} else {
			this.dragVelocity.set(0, 0, 0);
		}
		piece.root.position.copy(this.nextPosition);
		this.previousDragPosition.copy(this.nextPosition);
		this.lastDragTime = now;
		piece.status = 'moving';
	}

	#getGrabDistance() {
		const distance = this.state.dragDistance;
		if (Number.isFinite(distance)) return distance;
		return LAB_CONFIG.grabDistanceMin;
	}

	#releaseSelected(now) {
		const piece = this.state.pieces.find(item => item.id === this.state.selectedPieceId);
		if (!piece || (piece.status !== 'selected' && piece.status !== 'moving')) {
			this.state.selectedPieceId = null;
			this.state.selectedBy = null;
			return;
		}
		this.#clearTargetError();
		const result = validateDrop(piece, this.state.targets, LAB_CONFIG.assemblyToleranceMeters);
		this.state.selectedPieceId = null;
		this.state.selectedBy = null;
		if (result.accepted) {
			piece.status = 'placed';
			piece.physicsActive = false;
			piece.velocity.set(0, 0, 0);
			piece.root.position.copy(result.target.position);
			piece.root.quaternion.copy(result.target.quaternion);
			piece.material.emissive.set('#000000');
			setTargetStatus(result.target, 'placed');
			this.#clearTargetError();
			this.audio.playSuccess();
			const progress = getProgress(this.state);
			if (progress === this.state.pieces.length) {
				this.advanceTimer(now);
				this.state.phase = 'complete';
				this.state.timer.running = false;
				setMessage(this.state, `Completaste el ensamblaje en ${formatTime(this.state.timer.elapsedMs)}. ¡Buen trabajo!`, 'success', now);
			} else {
				this.state.phase = 'active';
				setMessage(this.state, `Pieza ${piece.name} colocada correctamente. ${progress} de 5 completadas.`, 'success', now);
			}
			return;
		}

		piece.status = 'available';
		this.#startPhysics(piece);
		piece.material.emissive.set('#000000');
		if (result.target && result.target.status !== 'placed') {
			setTargetStatus(result.target, 'error');
			this.state.ui.errorTargetId = result.target.id;
		}
		piece.material.emissive.set('#b64245');
		this.state.ui.errorPieceId = piece.id;
		this.audio.playError();
		if (result.reason === 'wrong-target') {
			setMessage(this.state, `Destino incorrecto para la pieza ${piece.name}. Comprueba la letra y la forma.`, 'error', now);
		} else {
			setMessage(this.state, 'La pieza quedó lejos de su destino. Acércala antes de soltarla.', 'error', now);
		}
	}

	#startPhysics(piece) {
		piece.velocity.copy(this.dragVelocity).clampLength(0, LAB_CONFIG.maxThrowSpeed);
		piece.physicsActive = true;
	}

	#pauseTimer(now) {
		this.advanceTimer(now);
		this.state.timer.running = false;
	}

	#expireTargetFeedback(now) {
		if (now < this.state.ui.errorUntil) return;
		const target = this.state.targets.find(item => item.id === this.state.ui.errorTargetId);
		if (target && target.status === 'error') setTargetStatus(target, 'available');
		const piece = this.state.pieces.find(item => item.id === this.state.ui.errorPieceId);
		if (piece && piece.status !== 'placed') piece.material.emissive.set('#000000');
		this.state.ui.errorTargetId = null;
		this.state.ui.errorPieceId = null;
	}

	#clearTargetError() {
		const target = this.state.targets.find(item => item.id === this.state.ui.errorTargetId);
		if (target?.status === 'error') setTargetStatus(target, 'available');
		const piece = this.state.pieces.find(item => item.id === this.state.ui.errorPieceId);
		if (piece && piece.status !== 'placed') piece.material.emissive.set('#000000');
		this.state.ui.errorTargetId = null;
		this.state.ui.errorPieceId = null;
		this.state.ui.errorUntil = 0;
	}

	#setHoverState(controlId, pieceId) {
		this.panel.setHovered(controlId);
		if (this.hoveredPieceId && this.hoveredPieceId !== this.state.selectedPieceId) {
			const previous = this.state.pieces.find(item => item.id === this.hoveredPieceId);
			if (previous && previous.status === 'available') previous.material.emissive.set('#000000');
		}
		if (pieceId && pieceId !== this.state.selectedPieceId) {
			const current = this.state.pieces.find(item => item.id === pieceId);
			if (current && current.status === 'available') current.material.emissive.set('#384b42');
		}
		this.hoveredPieceId = pieceId;
	}
}
