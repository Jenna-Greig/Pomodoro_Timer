const BREAK_WARNING_DURATION = 5 * 1000;
const TRANSITION_BELL_SPACING_SECONDS = 1.25;

const menuScreen = document.getElementById("menu-screen");
const timerScreen = document.getElementById("timer-screen");
const sessionPreset = document.getElementById("session-preset");
const selectedPresetLabel = document.getElementById("selected-preset");
const presetOptions = document.getElementById("preset-options");
const presetOptionItems = presetOptions?.querySelectorAll('[role="option"]');
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const timerDisplay = document.getElementById("timerDisplay");
const phaseLabel = document.getElementById("phase-label");
const videoBackground = document.querySelector(".video-background");
const wallpaperButton = document.getElementById("wallpaper-button");
const soundButton = document.getElementById("sound-button");
const wallpaperDialog = document.getElementById("wallpaper-dialog");
const soundDialog = document.getElementById("sound-dialog");
const audioStatus = document.getElementById("audio-status");
const wallpaperColor = document.getElementById("wallpaper-color");
const solidWallpaperPreview = document.getElementById("solid-wallpaper-preview");
const wallpaperFile = document.getElementById("wallpaper-file");
const importedWallpaperPreview = document.getElementById("imported-wallpaper-preview");
const wallpaperStatus = document.getElementById("wallpaper-status");
const wallpaperChoices = wallpaperDialog?.querySelectorAll('[name="wallpaper"]');
const defaultVideoSource = videoBackground?.querySelector("source")?.getAttribute("src");

if (
    !menuScreen ||
    !timerScreen ||
    !sessionPreset ||
    !selectedPresetLabel ||
    !presetOptions ||
    !presetOptionItems?.length ||
    !startButton ||
    !pauseButton ||
    !resetButton ||
    !timerDisplay ||
    !phaseLabel ||
    !videoBackground ||
    !wallpaperButton ||
    !soundButton ||
    !wallpaperDialog ||
    !soundDialog ||
    !audioStatus ||
    !wallpaperColor ||
    !solidWallpaperPreview ||
    !wallpaperFile ||
    !importedWallpaperPreview ||
    !wallpaperStatus ||
    !defaultVideoSource ||
    !wallpaperChoices?.length
) {
    throw new Error("The Pomodoro timer controls are missing from the page.");
}

let studyDuration = 50 * 60 * 1000;
let breakDuration = 10 * 60 * 1000;
let remainingMilliseconds = studyDuration;
let currentPhase = "study";
let endTime = null;
let intervalId = null;
let audioContext = null;
let importedWallpaperUrl = null;
const ambientGains = new Map();
const transitionBellTones = new Map();
let transitionBellRequest = 0;

function readPreset() {
    const [studyValue, breakValue] = sessionPreset.dataset.value.split(":");
    const toMilliseconds = (value) => {
        const duration = Number.parseFloat(value);
        const unit = value.endsWith("s") ? 1000 : 60 * 1000;
        return duration * unit;
    };

    studyDuration = toMilliseconds(studyValue);
    breakDuration = toMilliseconds(breakValue);
}

function setPreset(value) {
    const selectedOption = Array.from(presetOptionItems).find((option) => option.dataset.value === value);
    if (!selectedOption) {
        throw new Error(`Unknown study and break preset: ${value}`);
    }

    sessionPreset.dataset.value = value;
    selectedPresetLabel.textContent = selectedOption.textContent.trim();

    presetOptionItems.forEach((option) => {
        option.setAttribute("aria-selected", String(option === selectedOption));
    });

    readPreset();
}

function closePresetOptions(returnFocus = false) {
    presetOptions.hidden = true;
    sessionPreset.setAttribute("aria-expanded", "false");
    if (returnFocus) {
        sessionPreset.focus();
    }
}

function openPresetOptions() {
    presetOptions.hidden = false;
    sessionPreset.setAttribute("aria-expanded", "true");
    const selectedOption = Array.from(presetOptionItems).find(
        (option) => option.dataset.value === sessionPreset.dataset.value
    );
    selectedOption?.focus();
}

function movePresetFocus(currentOption, direction) {
    const options = Array.from(presetOptionItems);
    const currentIndex = options.indexOf(currentOption);
    const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + direction));
    options[nextIndex].focus();
}

function closeDialog(dialog) {
    if (dialog.open) {
        dialog.close();
    }
}

function createNoiseBuffer(context) {
    const durationSeconds = 5;
    const buffer = context.createBuffer(1, context.sampleRate * durationSeconds, context.sampleRate);
    const samples = buffer.getChannelData(0);

    for (let index = 0; index < samples.length; index += 1) {
        samples[index] = Math.random() * 2 - 1;
    }

    return buffer;
}

function createAmbientChannel(context, buffer, name, filterType, frequency) {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = buffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
    ambientGains.set(name, gain);
}

function initializeAmbientAudio() {
    if (audioContext) {
        return audioContext.resume();
    }

    if (!window.AudioContext) {
        audioStatus.textContent = "Ambient audio is not supported in this browser.";
        return Promise.resolve();
    }

    audioContext = new window.AudioContext();
    const noiseBuffer = createNoiseBuffer(audioContext);
    createAmbientChannel(audioContext, noiseBuffer, "rain", "bandpass", 1200);
    createAmbientChannel(audioContext, noiseBuffer, "wind", "lowpass", 350);
    createAmbientChannel(audioContext, noiseBuffer, "soft-noise", "lowpass", 1800);
    return audioContext.resume();
}

async function openSoundDialog() {
    soundDialog.showModal();
    const hasActiveSound = Array.from(soundDialog.querySelectorAll('input[type="range"]')).some(
        (slider) => Number(slider.value) > 0
    );
    audioStatus.textContent = hasActiveSound ? "Ambient sound mix is active." : "Sounds are off.";

    try {
        await initializeAmbientAudio();
    } catch (error) {
        audioStatus.textContent = "Audio could not start. Check your browser's audio settings and try again.";
        console.error("Could not start ambient audio.", error);
    }
}

function updateAmbientVolume(name, value) {
    const gain = ambientGains.get(name);
    if (gain && audioContext) {
        gain.gain.setTargetAtTime((Number(value) / 100) * 0.18, audioContext.currentTime, 0.04);
    }
}

function playTransitionBell(durationMilliseconds = BREAK_WARNING_DURATION) {
    if (!audioContext) {
        return;
    }

    const context = audioContext;
    const request = ++transitionBellRequest;
    const scheduleBell = () => {
        if (request !== transitionBellRequest || context.state !== "running") {
            return;
        }

        const transitionStart = context.currentTime;
        const chimeSpacing = TRANSITION_BELL_SPACING_SECONDS;
        const transitionEnd = transitionStart + durationMilliseconds / 1000;

        [0, 1, 2].forEach((chimeIndex) => {
            const chimeStart = transitionStart + chimeIndex * chimeSpacing;
            const chimeDuration = Math.min(0.8, transitionEnd - chimeStart);
            if (chimeDuration <= 0.025) {
                return;
            }

            [
                { frequency: 1100, volume: 0.09 },
                { frequency: 1650, volume: 0.04 },
            ].forEach(({ frequency, volume }) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();

                oscillator.type = "sine";
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0.0001, chimeStart);
                gain.gain.exponentialRampToValueAtTime(volume, chimeStart + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001, chimeStart + chimeDuration);

                oscillator.connect(gain);
                gain.connect(context.destination);
                transitionBellTones.set(oscillator, gain);
                oscillator.addEventListener("ended", () => transitionBellTones.delete(oscillator), { once: true });
                oscillator.start(chimeStart);
                oscillator.stop(chimeStart + chimeDuration + 0.05);
            });
        });
    };

    if (context.state === "running") {
        scheduleBell();
    } else {
        context.resume().then(scheduleBell).catch((error) => {
            console.error("Could not play the focus-to-break bell.", error);
        });
    }
}

function stopTransitionBell() {
    transitionBellRequest += 1;
    if (!audioContext) {
        return;
    }

    const now = audioContext.currentTime;
    transitionBellTones.forEach((gain, oscillator) => {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
        oscillator.stop(now + 0.05);
    });
    transitionBellTones.clear();
}

sessionPreset.addEventListener("click", () => {
    if (presetOptions.hidden) {
        openPresetOptions();
    } else {
        closePresetOptions();
    }
});

sessionPreset.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openPresetOptions();
    }
});

presetOptionItems.forEach((option) => {
    option.addEventListener("click", () => {
        setPreset(option.dataset.value);
        closePresetOptions(true);
    });

    option.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            movePresetFocus(option, 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            movePresetFocus(option, -1);
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const options = Array.from(presetOptionItems);
            options[event.key === "Home" ? 0 : options.length - 1].focus();
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setPreset(option.dataset.value);
            closePresetOptions(true);
        } else if (event.key === "Escape" || event.key === "Tab") {
            closePresetOptions(event.key === "Escape");
        }
    });
});

document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".preset-picker")) {
        closePresetOptions();
    }
});

wallpaperButton.addEventListener("click", () => wallpaperDialog.showModal());
soundButton.addEventListener("click", openSoundDialog);

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.closest("dialog")));
});

function applySolidWallpaper() {
    videoBackground.hidden = true;
    videoBackground.pause();
    document.body.classList.remove("imported-image-wallpaper");
    document.body.classList.add("solid-wallpaper");
    document.body.style.removeProperty("background-image");
    document.body.style.setProperty("--solid-wallpaper-color", wallpaperColor.value);
    solidWallpaperPreview.style.backgroundColor = wallpaperColor.value;
}

async function applyVideoWallpaper(source) {
    document.body.classList.remove("solid-wallpaper", "imported-image-wallpaper");
    document.body.style.removeProperty("background-image");
    videoBackground.hidden = false;

    if (source) {
        videoBackground.src = source;
    } else {
        videoBackground.removeAttribute("src");
    }

    videoBackground.load();
    try {
        await videoBackground.play();
        return true;
    } catch (error) {
        wallpaperStatus.textContent = "The selected video could not be played in this browser.";
        console.error("Could not play selected wallpaper video.", error);
        return false;
    }
}

function selectWallpaperChoice(value) {
    wallpaperChoices.forEach((choice) => {
        choice.checked = choice.value === value;
    });
}

wallpaperChoices.forEach((choice) => {
    choice.addEventListener("change", async () => {
        importedWallpaperPreview.closest(".wallpaper-import-option")?.classList.remove("is-selected");
        if (choice.value === "solid") {
            applySolidWallpaper();
            wallpaperStatus.textContent = "";
        } else {
            if (await applyVideoWallpaper()) {
                wallpaperStatus.textContent = "";
                closeDialog(wallpaperDialog);
            }
        }
    });
});

wallpaperColor.addEventListener("input", () => {
    selectWallpaperChoice("solid");
    applySolidWallpaper();
    wallpaperStatus.textContent = "";
});

wallpaperFile.addEventListener("change", async () => {
    const file = wallpaperFile.files?.[0];
    if (!file) {
        return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type === "video/mp4" || file.type === "video/webm";
    if (!isImage && !isVideo) {
        wallpaperStatus.textContent = "Choose a supported image, MP4, or WebM file.";
        wallpaperFile.value = "";
        return;
    }

    if (importedWallpaperUrl) {
        URL.revokeObjectURL(importedWallpaperUrl);
    }
    importedWallpaperUrl = URL.createObjectURL(file);
    importedWallpaperPreview.style.backgroundImage = `url("${importedWallpaperUrl}")`;
    importedWallpaperPreview.closest(".wallpaper-import-option")?.classList.add("is-selected");
    wallpaperStatus.textContent = `Using ${file.name}. This wallpaper is available until you close or reload the page.`;
    selectWallpaperChoice("");

    if (isImage) {
        videoBackground.pause();
        videoBackground.hidden = true;
        videoBackground.removeAttribute("src");
        videoBackground.load();
        document.body.classList.remove("solid-wallpaper");
        document.body.classList.add("imported-image-wallpaper");
        document.body.style.removeProperty("--solid-wallpaper-color");
        document.body.style.backgroundImage = `url("${importedWallpaperUrl}")`;
    } else {
        document.body.classList.remove("solid-wallpaper", "imported-image-wallpaper");
        document.body.style.removeProperty("background-image");
        videoBackground.hidden = false;
        videoBackground.src = importedWallpaperUrl;
        videoBackground.load();
        try {
            await videoBackground.play();
        } catch (error) {
            wallpaperStatus.textContent = "The selected video could not be played in this browser.";
            console.error("Could not play selected wallpaper video.", error);
            return;
        }
    }
});

window.addEventListener("beforeunload", () => {
    if (importedWallpaperUrl) {
        URL.revokeObjectURL(importedWallpaperUrl);
    }
});

[
    ["rain-volume", "rain-volume-value", "rain"],
    ["wind-volume", "wind-volume-value", "wind"],
    ["noise-volume", "noise-volume-value", "soft-noise"],
].forEach(([sliderId, outputId, soundName]) => {
    const slider = document.getElementById(sliderId);
    const output = document.getElementById(outputId);

    if (!slider || !output) {
        throw new Error(`The ${soundName} volume control is missing from the page.`);
    }

    slider.addEventListener("input", () => {
        output.value = `${slider.value}%`;
        output.textContent = `${slider.value}%`;
        updateAmbientVolume(soundName, slider.value);
        audioStatus.textContent = audioContext
            ? "Adjust the sliders to mix the ambient sounds."
            : "Ambient audio is unavailable in this browser.";
    });
});

function renderTime() {
    const totalSeconds = Math.ceil(remainingMilliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    timerDisplay.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopCountdown() {
    if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
    }

    endTime = null;
}

function updateCountdown() {
    if (endTime === null) {
        return;
    }

    remainingMilliseconds = Math.max(0, endTime - Date.now());
    renderTime();

    if (remainingMilliseconds === 0) {
        stopCountdown();
        if (currentPhase === "study") {
            currentPhase = "break-warning";
            remainingMilliseconds = BREAK_WARNING_DURATION;
            phaseLabel.textContent = "Break starts in";
            renderTime();
            playTransitionBell();
            startCountdown();
        } else if (currentPhase === "break-warning") {
            currentPhase = "break";
            remainingMilliseconds = breakDuration;
            phaseLabel.textContent = "Break time";
            renderTime();
            startCountdown();
        } else if (currentPhase === "break") {
            currentPhase = "study-warning";
            remainingMilliseconds = BREAK_WARNING_DURATION;
            phaseLabel.textContent = "Study starts in";
            renderTime();
            playTransitionBell();
            startCountdown();
        } else {
            currentPhase = "study";
            remainingMilliseconds = studyDuration;
            phaseLabel.textContent = "Study time";
            renderTime();
            startCountdown();
        }
    }
}

function startCountdown() {
    if (remainingMilliseconds === 0) {
        return;
    }

    endTime = Date.now() + remainingMilliseconds;
    intervalId = window.setInterval(updateCountdown, 250);
    pauseButton.textContent = "Pause";
    pauseButton.disabled = false;
    updateCountdown();
}

startButton.addEventListener("click", () => {
    try {
        initializeAmbientAudio().catch((error) => {
            console.error("Could not initialize audio for the focus-to-break bell.", error);
        });
    } catch (error) {
        console.error("Could not initialize audio for the focus-to-break bell.", error);
    }
    readPreset();
    currentPhase = "study";
    remainingMilliseconds = studyDuration;
    phaseLabel.textContent = "Study time";
    menuScreen.hidden = true;
    timerScreen.hidden = false;
    renderTime();
    startCountdown();
});

pauseButton.addEventListener("click", () => {
    if (intervalId !== null) {
        updateCountdown();
        stopCountdown();
        stopTransitionBell();
        pauseButton.textContent = "Resume";
        return;
    }

    if (currentPhase === "break-warning" || currentPhase === "study-warning") {
        playTransitionBell(remainingMilliseconds);
    }
    startCountdown();
});

resetButton.addEventListener("click", () => {
    stopCountdown();
    stopTransitionBell();
    readPreset();
    currentPhase = "study";
    remainingMilliseconds = studyDuration;
    renderTime();
    pauseButton.textContent = "Pause";
    pauseButton.disabled = false;
    phaseLabel.textContent = "Study time";
    timerScreen.hidden = true;
    menuScreen.hidden = false;
});

readPreset();
renderTime();