import { initControls } from "./controls.js"
import { connectCam } from "./camera.js"
import { initVisualizer, connectAudio, initAudioButton } from "./audio.js"
import { initRecording } from "./recording.js"
import { fetchStyles } from "./voice-pipeline.js"

initVisualizer()
initControls()
initRecording()
connectCam()
connectAudio()
initAudioButton()
fetchStyles()
