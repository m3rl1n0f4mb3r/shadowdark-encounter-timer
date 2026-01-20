/**
 * Shadowdark Encounter Timer Module for Foundry VTT
 * Integrates with Shadow Dark Crawl Helper to trigger encounter checks
 */

/**
 * Logging utility with debug mode support
 */
function log(force, ...args) {
  const shouldLog =
    force ||
    game.modules
      .get("_dev-mode")
      ?.api?.getPackageDebugValue("shadowdark-encounter-timer");

  if (shouldLog) {
    console.log("shadowdark-encounter-timer", "|", ...args);
  }
}

class ShadowdarkEncounterTimerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super(options);

    this.timeRemaining = 0;
    this.totalTime = 0;
    this.isRunning = false;
    this.intervalId = null;
    this.lastUpdate = null;
    this.wasAutoPaused = false; // Track if paused by combat
    this.wasGamePaused = false; // Track if paused by Foundry game pause
    this.autoRestart = true;
  }

  static DEFAULT_OPTIONS = {
    id: "shadowdark-encounter-timer",
    window: {
      title: "shadowdark-encounter-timer.ui.title", // Changed from hardcoded string
      resizable: false,
    },
    position: {
      width: 300,
      height: "auto",
    },
    classes: ["shadowdark-encounter-timer"],
  };

  static PARTS = {
    timer: {
      template: "modules/shadowdark-encounter-timer/templates/timer.hbs",
    },
  };

  _prepareContext(options) {
    const isGM = game.user.isGM;

    return {
      isGM: isGM,
      isRunning: this.isRunning,
      autoRestart: this.autoRestart,
      timeDisplay: this.formatTime(this.timeRemaining),
      progress:
        this.totalTime > 0
          ? ((this.totalTime - this.timeRemaining) / this.totalTime) * 100
          : 0,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    if (game.user.isGM) {
      this.element
        .querySelector(".start-pause-btn")
        ?.addEventListener("click", () => this.toggleTimer());
      this.element
        .querySelector(".reset-btn")
        ?.addEventListener("click", () => this.resetTimer());
      this.element
        .querySelector(".auto-restart-toggle")
        ?.addEventListener("click", () => this.toggleAutoRestart());
    }
  }

  _attachFrameListeners() {
    super._attachFrameListeners();
    // If timer is running but tick stopped (e.g., after closing and reopening), restart it
    if (this.isRunning && !this.intervalId) {
      this.lastUpdate = Date.now();
      this.tick();
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  toggleTimer() {
    if (this.isRunning) {
      this.pauseTimer();
    } else {
      this.startTimer();
    }
  }

  startTimer() {
    // Clear auto-pause flags when manually starting
    this.wasAutoPaused = false;
    this.wasGamePaused = false;

    if (this.timeRemaining === 0) {
      // Initialize timer with duration from settings
      const duration = game.settings.get(
        "shadowdark-encounter-timer",
        "timerDuration"
      );
      this.totalTime = duration * 60;
      this.timeRemaining = this.totalTime;
    }

    this.isRunning = true;
    this.lastUpdate = Date.now();

    // Broadcast to all clients
    game.socket.emit("module.shadowdark-encounter-timer", {
      action: "start",
      timeRemaining: this.timeRemaining,
      totalTime: this.totalTime,
    });

    this.tick();

    // Only render if window is currently visible
    if (this.rendered) {
      this.render(true);
    }
  }

  pauseTimer() {
    this.isRunning = false;

    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    // Broadcast to all clients
    game.socket.emit("module.shadowdark-encounter-timer", {
      action: "pause",
      timeRemaining: this.timeRemaining,
      wasAutoPaused: this.wasAutoPaused,
    });

    // Only render if window is currently visible
    if (this.rendered) {
      this.render();
    }
  }

  handleCombatStart() {
    const pauseOnCombat = game.settings.get(
      "shadowdark-encounter-timer",
      "pauseOnCombat"
    );

    if (pauseOnCombat && this.isRunning) {
      log(false, "Auto-pausing for combat");
      this.wasAutoPaused = true;
      this.pauseTimer();
    }
  }

  handleCombatEnd() {
    const resumeAfterCombat = game.settings.get(
      "shadowdark-encounter-timer",
      "resumeAfterCombat"
    );

    if (resumeAfterCombat && this.wasAutoPaused && !this.isRunning) {
      log(false, "Auto-resuming after combat");
      this.wasAutoPaused = false;
      this.startTimer();
    }
  }

  handleGamePause() {
    const pauseOnGamePause = game.settings.get(
      "shadowdark-encounter-timer",
      "pauseOnGamePause"
    );

    if (pauseOnGamePause && this.isRunning) {
      log(false, "Auto-pausing for game pause");
      this.wasGamePaused = true;
      this.pauseTimer();
    }
  }

  handleGameUnpause() {
    const resumeAfterGamePause = game.settings.get(
      "shadowdark-encounter-timer",
      "resumeAfterGamePause"
    );

    if (resumeAfterGamePause && this.wasGamePaused && !this.isRunning) {
      log(false, "Auto-resuming after game unpause");
      this.wasGamePaused = false;
      this.startTimer();
    }
  }

  resetTimer() {
    this.isRunning = false;
    this.wasAutoPaused = false;
    this.wasGamePaused = false;
    this.timeRemaining = 0;
    this.totalTime = 0;

    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    // Broadcast to all clients
    game.socket.emit("module.shadowdark-encounter-timer", {
      action: "reset",
    });

    // Only render if window is currently visible
    if (this.rendered) {
      this.render();
    }
  }

  toggleAutoRestart() {
    this.autoRestart = !this.autoRestart;

    // Broadcast to all clients
    game.socket.emit("module.shadowdark-encounter-timer", {
      action: "toggleAutoRestart",
      autoRestart: this.autoRestart,
    });

    this.render();
  }

  tick() {
    if (!this.isRunning) return;

    const now = Date.now();
    const elapsed = Math.floor((now - this.lastUpdate) / 1000);

    if (elapsed >= 1) {
      this.timeRemaining = Math.max(0, this.timeRemaining - elapsed);
      this.lastUpdate = now;
      this.render();

      if (this.timeRemaining === 0) {
        this.onTimerComplete();
        return;
      }
    }

    // Schedule next tick
    this.intervalId = setTimeout(() => this.tick(), 100);
  }

  async onTimerComplete() {
    this.isRunning = false;

    // Advance crawl round if setting is enabled and combat exists
    const advanceCrawlRound = game.settings.get(
      "shadowdark-encounter-timer",
      "advanceCrawlRound"
    );

    if (
      advanceCrawlRound &&
      game.combat?.type === "shadowdark-crawl-helper.crawl"
    ) {
      log(false, "Advancing crawl round");
      try {
        // Advance to next round - Crawl Helper will handle encounter checks
        await game.combat.nextRound();
      } catch (error) {
        log(true, "ERROR: Error advancing crawl round:", error);
        ui.notifications.error(
          game.i18n.localize("shadowdark-encounter-timer.notifications.errorAdvancingRound")
        );
      }
    } else {
      // Fallback: If not in a crawl, trigger encounter check manually
      if (game.modules.get("shadowdark-crawl-helper")?.active) {
        try {
          const gmToolsInstance = game.crawlHelper?.gmtools;

          if (gmToolsInstance) {
            await gmToolsInstance.constructor.triggerEncounterCheck.call(
              gmToolsInstance
            );
          } else {
            ui.notifications.warn(
              game.i18n.localize("shadowdark-encounter-timer.notifications.crawlHelperNotFound")
            );
          }
        } catch (error) {
          log(true, "ERROR: Error triggering encounter check:", error);
          ui.notifications.error(
            game.i18n.localize("shadowdark-encounter-timer.notifications.errorTriggeringEncounter")
          );
        }
      } else {
        ui.notifications.warn(
          game.i18n.localize("shadowdark-encounter-timer.notifications.crawlHelperNotActive")
        );
      }
    }

    // Only render if window is currently visible (to update the completed state)
    if (this.rendered) {
      this.render(true);
    }

    // Auto-restart the timer if enabled
    if (this.autoRestart) {
      setTimeout(() => {
        // Only restart timer, don't show window if it was closed
        if (this.timeRemaining === 0) {
          const duration = game.settings.get(
            "shadowdark-encounter-timer",
            "timerDuration"
          );
          this.totalTime = duration * 60;
          this.timeRemaining = this.totalTime;
        }

        this.isRunning = true;
        this.lastUpdate = Date.now();

        // Broadcast to all clients
        game.socket.emit("module.shadowdark-encounter-timer", {
          action: "start",
          timeRemaining: this.timeRemaining,
          totalTime: this.totalTime,
        });

        this.tick();

        // Only render if window is currently visible
        if (this.rendered) {
          this.render(true);
        }
      }, 2000);
    }
  }

  // Handle socket messages for syncing across clients
  handleSocketMessage(data) {
    switch (data.action) {
      case "start":
        this.timeRemaining = data.timeRemaining;
        this.totalTime = data.totalTime;
        this.isRunning = true;
        this.lastUpdate = Date.now();
        this.tick();
        this.render();
        break;

      case "pause":
        this.isRunning = false;
        this.timeRemaining = data.timeRemaining;
        if (data.wasAutoPaused !== undefined) {
          this.wasAutoPaused = data.wasAutoPaused;
        }
        if (this.intervalId) {
          clearTimeout(this.intervalId);
          this.intervalId = null;
        }
        this.render();
        break;

      case "reset":
        this.isRunning = false;
        this.timeRemaining = 0;
        this.totalTime = 0;
        if (this.intervalId) {
          clearTimeout(this.intervalId);
          this.intervalId = null;
        }
        this.render();
        break;

      case "toggleAutoRestart":
        this.autoRestart = data.autoRestart;
        this.render();
        break;
    }
  }

  async close(options) {
    // Don't stop the timer when closing the window
    // The timer continues running in the background
    return super.close(options);
  }

  _onClose(options) {
    // Override to prevent stopping the timer when window closes
    // Just hide the window, don't cleanup
    super._onClose(options);
  }
}

// Initialize module
Hooks.once("init", () => {
  log(true, "Initializing");

  // Register settings
  game.settings.register("shadowdark-encounter-timer", "timerDuration", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.timerDuration.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.timerDuration.hint"
    ),
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    range: {
      min: 1,
      max: 60,
      step: 1,
    },
    onChange: () => {
      if (game.shadowdarkEncounterTimer) {
        game.shadowdarkEncounterTimer.resetTimer();
      }
    },
  });

  game.settings.register("shadowdark-encounter-timer", "pauseOnCombat", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.pauseOnCombat.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.pauseOnCombat.hint"
    ),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("shadowdark-encounter-timer", "resumeAfterCombat", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.resumeAfterCombat.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.resumeAfterCombat.hint"
    ),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("shadowdark-encounter-timer", "pauseOnGamePause", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.pauseOnGamePause.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.pauseOnGamePause.hint"
    ),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("shadowdark-encounter-timer", "resumeAfterGamePause", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.resumeAfterGamePause.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.resumeAfterGamePause.hint"
    ),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("shadowdark-encounter-timer", "advanceCrawlRound", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.advanceCrawlRound.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.advanceCrawlRound.hint"
    ),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("shadowdark-encounter-timer", "showToPlayers", {
    name: game.i18n.localize(
      "shadowdark-encounter-timer.settings.showToPlayers.name"
    ),
    hint: game.i18n.localize(
      "shadowdark-encounter-timer.settings.showToPlayers.hint"
    ),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
});

Hooks.once("ready", () => {
  log(true, "Ready");

  // Create the timer app instance
  game.shadowdarkEncounterTimer = new ShadowdarkEncounterTimerApp();

  // Setup socket listener
  game.socket.on("module.shadowdark-encounter-timer", (data) => {
    if (game.shadowdarkEncounterTimer) {
      game.shadowdarkEncounterTimer.handleSocketMessage(data);
    }
  });

  // Setup combat detection hooks
  // Crawl Helper uses updateCombat to toggle combat mode via game.combat.system.inCombat
  log(false, "Setting up combat hooks");

  Hooks.on("updateCombat", (combat, changed, options, userId) => {
    // Check if the combat system's inCombat flag changed
    if (changed.system?.inCombat !== undefined) {
      log(false, "Combat state changed:", changed.system.inCombat);

      if (changed.system.inCombat === true) {
        // Combat started
        log(false, "Combat started");
        if (game.shadowdarkEncounterTimer) {
          game.shadowdarkEncounterTimer.handleCombatStart();
        }
      } else if (changed.system.inCombat === false) {
        // Combat ended
        log(false, "Combat ended");
        if (game.shadowdarkEncounterTimer) {
          game.shadowdarkEncounterTimer.handleCombatEnd();
        }
      }
    }
  });

  // Also handle when combat is deleted entirely
  Hooks.on("deleteCombat", (combat) => {
    log(false, "Combat deleted");
    if (
      game.shadowdarkEncounterTimer &&
      game.shadowdarkEncounterTimer.wasAutoPaused
    ) {
      game.shadowdarkEncounterTimer.handleCombatEnd();
    }
  });

  // Handle Foundry game pause/unpause
  Hooks.on("pauseGame", (paused) => {
    log(false, "Game pause state changed:", paused);
    if (game.shadowdarkEncounterTimer) {
      if (paused) {
        game.shadowdarkEncounterTimer.handleGamePause();
      } else {
        game.shadowdarkEncounterTimer.handleGameUnpause();
      }
    }
  });
});

// Add button to scene controls for GM - register this hook outside of ready
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  log(false, "getSceneControlButtons hook fired");

  // In V13, controls is an object with control groups as properties
  const tokenControls = controls.tokens;
  if (tokenControls) {
    // Add to the tools object
    tokenControls.tools.encounterTimer = {
      name: "encounterTimer",
      title: game.i18n.localize("shadowdark-encounter-timer.ui.title"),
      icon: "fas fa-clock",
      button: true,
      order: 99, // Place it at the end
      onClick: () => {
        log(false, "Timer button clicked");
        if (game.shadowdarkEncounterTimer?.rendered) {
          game.shadowdarkEncounterTimer.close();
        } else {
          game.shadowdarkEncounterTimer?.render(true);
          // If timer was running, make sure it continues
          if (
            game.shadowdarkEncounterTimer.isRunning &&
            !game.shadowdarkEncounterTimer.intervalId
          ) {
            game.shadowdarkEncounterTimer.lastUpdate = Date.now();
            game.shadowdarkEncounterTimer.tick();
          }
        }
      },
    };
    log(false, "Timer button added to token controls");
  } else {
    log(true, "WARNING: Token controls not found", controls);
  }
});
