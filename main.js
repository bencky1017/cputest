import { benchmarks } from './benchmarks.js';

// DOM elements
const totalScoreEl = document.getElementById('totalScore');
const scoreLabelEl = document.getElementById('scoreLabel');
const statusTextEl = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const benchmarkListEl = document.getElementById('benchmarkList');
const progressCircle = document.querySelector('.progress-ring__circle');

// State
let isRunning = false;
let totalScore = 0;
const results = {};

// Deterministic PRNG utilities to keep each benchmark workload identical per run
function createSeededRandom(seed) {
    let state = seed >>> 0 || 1;
    return function seededRandom() {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function getDeterministicSeed(benchmarkId, runIndex, baseSeed = 0) {
    let hash = 2166136261;
    const input = `${benchmarkId}:${baseSeed}:${runIndex}`;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const seed = (hash ^ baseSeed) >>> 0;
    return seed || 1;
}

// Initialize benchmark list
function initBenchmarkList() {
    benchmarkListEl.innerHTML = '';

    benchmarks.forEach(benchmark => {
        const item = document.createElement('div');
        item.className = 'benchmark-item';
        item.id = `bench-${benchmark.id}`;
        item.innerHTML = `
            <div class="item-info">
                <div class="item-name">${benchmark.name}</div>
                <div class="item-metric">${benchmark.unit}</div>
            </div>
            <div class="item-score">
                <span class="score-value">-</span>
                <div class="spinner"></div>
            </div>
        `;
        benchmarkListEl.appendChild(item);
    });
}

// Update progress ring
function updateProgressRing(percentage) {
    const circumference = 565.48;
    const offset = circumference - (percentage / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;
}

// Animate score
function animateScore(fromScore, toScore, duration = 500) {
    const startTime = performance.now();
    const diff = toScore - fromScore;

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        const currentScore = Math.floor(fromScore + diff * easeProgress);

        totalScoreEl.textContent = currentScore.toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

// Run single benchmark - Photo Library/Photo Filter runs 5 times, others run 10 times
// Removes highest and lowest, then takes average
async function runBenchmark(benchmark, iterations = 300) {
    return new Promise((resolve) => {
        const itemEl = document.getElementById(`bench-${benchmark.id}`);
        const scoreEl = itemEl.querySelector('.score-value');

        // Mark as active
        itemEl.classList.add('active');
        statusTextEl.textContent = `Running ${benchmark.name}...`;

        // Allow UI to update
        setTimeout(async () => {
            // Photo Library and Photo Filter run 5 times, others run 10 times
            const isPhotoTest = benchmark.id === 'photo' || benchmark.id === 'photo_filter';
            const numRuns = isPhotoTest ? 5 : 10;
            const rates = [];
            const scores = [];

            // Run the benchmark multiple times
            for (let run = 0; run < numRuns; run++) {
                statusTextEl.textContent = `Running ${benchmark.name}...`;

                const originalRandom = Math.random;
                const seededRandom = createSeededRandom(
                    getDeterministicSeed(benchmark.id, run, benchmark.seed || 0)
                );
                Math.random = seededRandom;

                const startTime = performance.now();
                let operations = 0;

                try {
                    // Run the benchmark multiple times
                    for (let i = 0; i < iterations; i++) {
                        operations += benchmark.fn();
                    }
                } finally {
                    Math.random = originalRandom;
                }

                const endTime = performance.now();
                const durationSec = (endTime - startTime) / 1000;
                const rate = operations / durationSec;
                rates.push(rate);

                // Calculate score based on base rate and base score
                const rawScore = (rate / benchmark.baseRate) * benchmark.baseScore;
                const score = Math.floor(rawScore / 1800);
                scores.push(score);

                // Small delay between runs
                if (run < numRuns - 1) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            // Remove highest and lowest, then calculate average
            rates.sort((a, b) => a - b);
            scores.sort((a, b) => a - b);

            // Remove first (lowest) and last (highest)
            const trimmedRates = rates.slice(1, -1);
            const trimmedScores = scores.slice(1, -1);

            const avgRate = trimmedRates.reduce((a, b) => a + b, 0) / trimmedRates.length;
            const avgScore = Math.floor(trimmedScores.reduce((a, b) => a + b, 0) / trimmedScores.length);

            // Update UI - show both rate and score
            itemEl.classList.remove('active');
            itemEl.classList.add('done');

            // Display rate value
            scoreEl.textContent = avgRate.toFixed(1);

            // Add score display below the rate
            const scoreDisplay = document.createElement('div');
            scoreDisplay.className = 'item-score-points';
            scoreDisplay.textContent = avgScore.toLocaleString();
            scoreEl.parentElement.appendChild(scoreDisplay);

            results[benchmark.id] = avgScore;

            resolve(avgScore);
        }, 50);
    });
}

// Run all benchmarks
async function runAllBenchmarks() {
    if (isRunning) return;

    isRunning = true;
    startBtn.disabled = true;
    totalScore = 0;

    // Reset all items
    document.querySelectorAll('.benchmark-item').forEach(item => {
        item.classList.remove('active', 'done');
        item.querySelector('.score-value').textContent = '-';
        const scorePoints = item.querySelector('.item-score-points');
        if (scorePoints) scorePoints.remove();
    });

    totalScoreEl.textContent = '0';
    updateProgressRing(0);

    const totalBenchmarks = benchmarks.length;
    let completedBenchmarks = 0;
    let totalScoreSum = 0;

    // Run each benchmark sequentially
    for (const benchmark of benchmarks) {
        const score = await runBenchmark(benchmark);
        completedBenchmarks++;

        // Accumulate score but don't display yet
        totalScoreSum += score;

        // Update progress
        const progress = (completedBenchmarks / totalBenchmarks) * 100;
        updateProgressRing(progress);

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Calculate final average score
    totalScore = Math.round(totalScoreSum / completedBenchmarks);

    // Complete - now animate and show the total score
    statusTextEl.textContent = 'Complete!';
    animateScore(0, totalScore, 800);

    startBtn.disabled = false;
    isRunning = false;

    // Add celebratory animation
    totalScoreEl.style.animation = 'none';
    setTimeout(() => {
        totalScoreEl.style.animation = 'pulse 1s ease-in-out';
    }, 10);
}

// Add pulse animation to CSS dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
    }
`;
document.head.appendChild(style);

// Event listeners
startBtn.addEventListener('click', runAllBenchmarks);

// Initialize on load
initBenchmarkList();
updateProgressRing(0);
