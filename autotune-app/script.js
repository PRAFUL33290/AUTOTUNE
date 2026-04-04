const recordBtn = document.getElementById('recordBtn');
const recordingIndicator = document.getElementById('recordingIndicator');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const processBtn = document.getElementById('processBtn');
const statusText = document.getElementById('statusText');
const scaleSelect = document.getElementById('scaleSelect');
const gainSlider = document.getElementById('gainSlider');
const gainValue = document.getElementById('gainValue');
const retuneSpeedSlider = document.getElementById('retuneSpeed');
const speedValue = document.getElementById('speedValue');
const downloadLink = document.getElementById('downloadLink');

let audioContext;
let mediaRecorder;
let audioChunks = [];
let recordedAudioBlob;
let tunedAudioBlob;
let tunedAudioBuffer;
let sourceNode;
let gainNode;
let isRecording = false;
let isPlaying = false;

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

const SCALE_CLASSES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

function setStatus(message) {
  statusText.textContent = message;
}

function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function setProcessingState(isProcessing) {
  processBtn.disabled = isProcessing || !recordedAudioBlob;
  playBtn.disabled = isProcessing || !tunedAudioBuffer;
  stopBtn.disabled = true;
  recordBtn.disabled = isProcessing;
}

function resetPlaybackUI() {
  isPlaying = false;
  playBtn.disabled = !tunedAudioBuffer;
  stopBtn.disabled = true;
  recordBtn.disabled = false;
}

gainSlider.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  gainValue.textContent = value.toFixed(1);
  if (gainNode) {
    gainNode.gain.value = value;
  }
});

retuneSpeedSlider.addEventListener('input', (e) => {
  speedValue.textContent = `${Math.round(parseFloat(e.target.value) * 100)}%`;
});

recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

playBtn.addEventListener('click', () => {
  if (!tunedAudioBuffer || isPlaying) {
    return;
  }

  initAudio();
  playAudioBuffer(tunedAudioBuffer);
});

stopBtn.addEventListener('click', () => {
  if (sourceNode && isPlaying) {
    sourceNode.stop();
    resetPlaybackUI();
  }
});

processBtn.addEventListener('click', async () => {
  if (!recordedAudioBlob) {
    return;
  }

  initAudio();
  setProcessingState(true);
  setStatus('Traitement autotune en cours...');

  try {
    const sourceArrayBuffer = await recordedAudioBlob.arrayBuffer();
    const sourceAudioBuffer = await audioContext.decodeAudioData(sourceArrayBuffer);

    tunedAudioBuffer = createAutotunedBuffer(sourceAudioBuffer, {
      scale: scaleSelect.value,
      strength: parseFloat(retuneSpeedSlider.value),
    });

    tunedAudioBlob = await audioBufferToWavBlob(tunedAudioBuffer);
    const tunedUrl = URL.createObjectURL(tunedAudioBlob);
    downloadLink.href = tunedUrl;
    downloadLink.classList.remove('hidden');

    playBtn.disabled = false;
    setStatus('Autotune prêt : écoute et téléchargement disponibles.');
  } catch (error) {
    console.error(error);
    setStatus('Erreur pendant le traitement. Réessaie avec un enregistrement plus court.');
  } finally {
    setProcessingState(false);
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
      recordedAudioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      tunedAudioBlob = undefined;
      tunedAudioBuffer = undefined;
      playBtn.disabled = true;
      processBtn.disabled = false;
      downloadLink.classList.add('hidden');
      setStatus('Enregistrement terminé. Clique sur « Appliquer Autotune ».');
    };

    mediaRecorder.start();
    isRecording = true;
    setStatus('Enregistrement en cours...');

    recordBtn.textContent = "⬛ Arrêter l'enregistrement";
    recordBtn.classList.add('recording');
    recordingIndicator.classList.remove('hidden');
    playBtn.disabled = true;
    stopBtn.disabled = true;
    processBtn.disabled = true;
    downloadLink.classList.add('hidden');
  } catch (error) {
    console.error(error);
    alert("Impossible d'accéder au microphone. Autorise l'accès puis réessaie.");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }

  isRecording = false;
  recordBtn.textContent = '🔴 Nouvel enregistrement';
  recordBtn.classList.remove('recording');
  recordingIndicator.classList.add('hidden');
}

function playAudioBuffer(buffer) {
  sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = buffer;

  gainNode = audioContext.createGain();
  gainNode.gain.value = parseFloat(gainSlider.value);

  sourceNode.connect(gainNode);
  gainNode.connect(audioContext.destination);

  sourceNode.onended = () => {
    resetPlaybackUI();
  };

  sourceNode.start(0);
  isPlaying = true;
  playBtn.disabled = true;
  stopBtn.disabled = false;
  recordBtn.disabled = true;
}

function createAutotunedBuffer(audioBuffer, options) {
  const { scale, strength } = options;
  const sampleRate = audioBuffer.sampleRate;
  const channelCount = audioBuffer.numberOfChannels;
  const output = audioContext.createBuffer(channelCount, audioBuffer.length, sampleRate);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const inputData = audioBuffer.getChannelData(channel);
    const outputData = output.getChannelData(channel);
    const normData = new Float32Array(audioBuffer.length);

    for (let start = 0; start + FRAME_SIZE < inputData.length; start += HOP_SIZE) {
      const frame = inputData.subarray(start, start + FRAME_SIZE);
      const detectedPitch = detectPitch(frame, sampleRate);
      const targetPitch = snapPitchToScale(detectedPitch, scale);

      let ratio = 1;
      if (detectedPitch > 0 && targetPitch > 0) {
        const fullRatio = targetPitch / detectedPitch;
        ratio = 1 + (fullRatio - 1) * strength;
      }

      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const readIndex = start + i * ratio;
        const sample = sampleLinear(inputData, readIndex);
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));

        if (start + i < outputData.length) {
          outputData[start + i] += sample * window;
          normData[start + i] += window;
        }
      }
    }

    for (let i = 0; i < outputData.length; i += 1) {
      if (normData[i] > 0) {
        outputData[i] /= normData[i];
      }
    }
  }

  return output;
}

function sampleLinear(buffer, index) {
  const i0 = Math.floor(index);
  const i1 = Math.min(i0 + 1, buffer.length - 1);
  if (i0 < 0 || i0 >= buffer.length) {
    return 0;
  }
  const frac = index - i0;
  return buffer[i0] * (1 - frac) + buffer[i1] * frac;
}

function detectPitch(frame, sampleRate) {
  const minFreq = 80;
  const maxFreq = 1000;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i < frame.length - lag; i += 1) {
      corr += frame[i] * frame[i + lag];
    }

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < 0.01) {
    return 0;
  }

  return sampleRate / bestLag;
}

function snapPitchToScale(pitch, scaleName) {
  if (!pitch || pitch <= 0) {
    return 0;
  }

  const allowedClasses = SCALE_CLASSES[scaleName] || SCALE_CLASSES.chromatic;
  const midi = 69 + 12 * Math.log2(pitch / 440);
  let bestMidi = Math.round(midi);
  let smallestDiff = Number.POSITIVE_INFINITY;

  for (let candidate = 24; candidate <= 96; candidate += 1) {
    if (!allowedClasses.includes(candidate % 12)) {
      continue;
    }

    const diff = Math.abs(candidate - midi);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestMidi = candidate;
    }
  }

  return 440 * 2 ** ((bestMidi - 69) / 12);
}

async function audioBufferToWavBlob(buffer) {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length * numberOfChannels * 2;
  const wavBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(wavBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

setStatus("Prêt : enregistre d'abord ta voix.");
