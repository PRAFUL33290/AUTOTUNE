// --- Elements de l'interface ---
const recordBtn = document.getElementById('recordBtn');
const recordingIndicator = document.getElementById('recordingIndicator');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const scaleSelect = document.getElementById('scaleSelect');
const gainSlider = document.getElementById('gainSlider');
const gainValue = document.getElementById('gainValue');
const retuneSpeedSlider = document.getElementById('retuneSpeed');
const speedValue = document.getElementById('speedValue');
const downloadLink = document.getElementById('downloadLink');

// --- Variables Audio ---
let audioContext;
let mediaRecorder;
let audioChunks = [];
let recordedAudioBlob;
let sourceNode;
let gainNode;
let isRecording = false;
let isPlaying = false;

// --- Mise à jour de l'UI des sliders ---
gainSlider.addEventListener('input', (e) => {
    gainValue.textContent = parseFloat(e.target.value).toFixed(1);
    if (gainNode) {
        gainNode.gain.value = parseFloat(e.target.value);
    }
});

retuneSpeedSlider.addEventListener('input', (e) => {
    speedValue.textContent = Math.round(e.target.value * 100) + '%';
});

// --- Initialisation AudioContext ---
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// --- Logique d'enregistrement ---
recordBtn.addEventListener('click', async () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            recordedAudioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            const url = URL.createObjectURL(recordedAudioBlob);

            // Préparer le lien de téléchargement (brut pour l'instant)
            downloadLink.href = url;
            downloadLink.classList.remove('hidden');

            // Activer le bouton de lecture
            playBtn.disabled = false;
        };

        mediaRecorder.start();
        isRecording = true;

        // UI updates
        recordBtn.textContent = '⬛ Stopper l\'enregistrement';
        recordBtn.classList.add('recording');
        recordingIndicator.classList.remove('hidden');
        playBtn.disabled = true;
        stopBtn.disabled = true;
        downloadLink.classList.add('hidden');

    } catch (err) {
        console.error("Erreur d'accès au microphone:", err);
        alert("Impossible d'accéder au microphone. Veuillez autoriser l'accès.");
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        // Couper le flux du micro
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    isRecording = false;

    // UI updates
    recordBtn.textContent = '🔴 Nouvel Enregistrement';
    recordBtn.classList.remove('recording');
    recordingIndicator.classList.add('hidden');
}

// --- Logique de lecture (Temporaire, sans autotune) ---
playBtn.addEventListener('click', async () => {
    if (!recordedAudioBlob || isPlaying) return;
    initAudio();

    try {
        const arrayBuffer = await recordedAudioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        playAudioBuffer(audioBuffer);
    } catch (err) {
        console.error("Erreur lors de la lecture:", err);
    }
});

stopBtn.addEventListener('click', () => {
    if (sourceNode && isPlaying) {
        sourceNode.stop();
        resetPlaybackUI();
    }
});

function playAudioBuffer(buffer) {
    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = buffer;

    // Gain Node pour le contrôle du volume du retour
    gainNode = audioContext.createGain();
    gainNode.gain.value = parseFloat(gainSlider.value);

    // Connexion basique (Source -> Gain -> Destination)
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    sourceNode.onended = () => {
        resetPlaybackUI();
    };

    sourceNode.start(0);
    isPlaying = true;

    // UI updates
    playBtn.disabled = true;
    stopBtn.disabled = false;
    recordBtn.disabled = true;
}

function resetPlaybackUI() {
    isPlaying = false;
    playBtn.disabled = false;
    stopBtn.disabled = true;
    recordBtn.disabled = false;
}

// --- Autotune AudioWorklet Concept ---
// Native WebAudio ne possède pas de PitchShifter temps réel sans modifier la vitesse.
// L'autotune nécessite: 1. Pitch Detection (YIN/AMDF) 2. Pitch Shifting (Phase Vocoder / PSOLA)
// Vu la complexité de l'implémentation d'un Vocoder en JS pur depuis zéro dans ce contexte,
// nous allons simuler un noeud de traitement qui représente là où la logique s'injecterait.
// Dans un projet de production de haute qualité, on importerait des librairies comme SoundTouchJS, ou un module WebAssembly (WASM).

const autotuneWorkletCode = `
class AutotuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.scale = 'chromatic';
    this.retuneSpeed = 0.5;

    this.port.onmessage = (event) => {
      if (event.data.type === 'updateParams') {
        this.scale = event.data.scale;
        this.retuneSpeed = event.data.retuneSpeed;
      }
    };
  }

  // Fonction factice pour la détection de pitch
  detectPitch(buffer) {
    // Dans la réalité: implémentation de l'algorithme YIN, McLeod, etc.
    return 440; // Retourne un A4 constant pour la démo
  }

  // Fonction factice de correction vers la gamme la plus proche
  getClosestNote(pitch, scale) {
     // Logique de map vers Majeur/Mineur
     return pitch;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    // Simulation de traitement par bloc
    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      // Ici s'effectuerait la FFT ou PSOLA :
      // 1. Détecter la fréquence du bloc
      // 2. Trouver la note cible dans 'this.scale'
      // 3. Appliquer le pitch shift en fonction de 'this.retuneSpeed'

      // Pour l'instant, on fait un simple bypass (passe-bande / effet robot simple pourrait être ajouté ici)
      for (let i = 0; i < inputChannel.length; ++i) {
        outputChannel[i] = inputChannel[i];
      }
    }
    return true;
  }
}

registerProcessor('autotune-processor', AutotuneProcessor);
`;

// Remplacement de la fonction de lecture pour inclure l'AudioWorklet
async function playAudioBuffer(buffer) {
    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = buffer;

    gainNode = audioContext.createGain();
    gainNode.gain.value = parseFloat(gainSlider.value);

    try {
        // Charger le worklet depuis un blob pour éviter les soucis CORS de fichiers locaux
        const blob = new Blob([autotuneWorkletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);

        await audioContext.audioWorklet.addModule(workletUrl);
        const autotuneNode = new AudioWorkletNode(audioContext, 'autotune-processor');

        // Mettre à jour les paramètres initiaux
        autotuneNode.port.postMessage({
            type: 'updateParams',
            scale: scaleSelect.value,
            retuneSpeed: parseFloat(retuneSpeedSlider.value)
        });

        // Ecouter les changements UI pendant la lecture
        scaleSelect.onchange = (e) => {
            autotuneNode.port.postMessage({ type: 'updateParams', scale: e.target.value, retuneSpeed: parseFloat(retuneSpeedSlider.value) });
        };
        retuneSpeedSlider.oninput = (e) => {
            speedValue.textContent = Math.round(e.target.value * 100) + '%';
            autotuneNode.port.postMessage({ type: 'updateParams', scale: scaleSelect.value, retuneSpeed: parseFloat(e.target.value) });
        };

        // Connexion : Source -> Autotune (Worklet) -> Gain -> Destination
        sourceNode.connect(autotuneNode);
        autotuneNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

    } catch(e) {
        console.warn("AudioWorklet non supporté ou erreur de chargement. Fallback vers lecture normale.", e);
        // Fallback si le worklet échoue
        sourceNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
    }

    sourceNode.onended = () => {
        resetPlaybackUI();
    };

    sourceNode.start(0);
    isPlaying = true;

    // UI updates
    playBtn.disabled = true;
    stopBtn.disabled = false;
    recordBtn.disabled = true;
}
