//! Which on-device tool is running and for how long.
//!
//! One source of truth for the routes, the status endpoint and the render
//! loop. The clock is injected so expiry can be unit-tested.

use std::time::{Duration, Instant};

pub trait Clock {
    fn now(&self) -> Instant;
}

#[derive(Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolKind {
    Countdown,
    SoundDetector,
    Scoreboard,
    /// Admin diagnostics hold: keeps the render loop quiet, not a user tool.
    Diagnostics,
}

impl ToolKind {
    /// Name used in the status API.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Countdown => "countdown",
            Self::SoundDetector => "sound_detector",
            Self::Scoreboard => "scoreboard",
            Self::Diagnostics => "diagnostics",
        }
    }
}

#[derive(Clone, Copy)]
struct Running {
    kind: ToolKind,
    /// `None` runs until [`ToolTimer::end`].
    until: Option<Instant>,
}

pub struct ToolTimer<C: Clock = SystemClock> {
    clock: C,
    running: Option<Running>,
}

impl Default for ToolTimer {
    fn default() -> Self {
        Self::new(SystemClock)
    }
}

impl<C: Clock> ToolTimer<C> {
    pub fn new(clock: C) -> Self {
        Self {
            clock,
            running: None,
        }
    }

    /// Record a tool as running, replacing any earlier one. Call this before
    /// sending the command so the render loop never sees a gap.
    pub fn begin(&mut self, kind: ToolKind, duration: Option<Duration>) {
        self.running = Some(Running {
            kind,
            until: duration.map(|d| self.clock.now() + d),
        });
    }

    /// Mark the tool as stopped. Returns whether one was running (even if it
    /// had already expired).
    pub fn end(&mut self) -> bool {
        self.running.take().is_some()
    }

    pub fn is_active(&self) -> bool {
        self.kind().is_some()
    }

    /// The running tool, or `None` when none was started or its time is up.
    pub fn kind(&self) -> Option<ToolKind> {
        let r = self.running?;
        match r.until {
            Some(until) if self.clock.now() >= until => None,
            _ => Some(r.kind),
        }
    }

    /// Time left on a timed tool. `None` for untimed tools and when expired.
    pub fn remaining(&self) -> Option<Duration> {
        let r = self.running?;
        let until = r.until?;
        until
            .checked_duration_since(self.clock.now())
            .filter(|d| !d.is_zero())
    }

    /// The tool that just ran out, exactly once, then forgets it.
    pub fn poll_expired(&mut self) -> Option<ToolKind> {
        match self.running {
            Some(r) if r.until.is_some() && self.kind().is_none() => {
                self.running = None;
                Some(r.kind)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    #[derive(Clone)]
    struct FakeClock(Rc<Cell<Instant>>);

    impl FakeClock {
        fn new() -> Self {
            Self(Rc::new(Cell::new(Instant::now())))
        }
        fn advance(&self, secs: u64) {
            self.0.set(self.0.get() + Duration::from_secs(secs));
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            self.0.get()
        }
    }

    fn secs(n: u64) -> Option<Duration> {
        Some(Duration::from_secs(n))
    }

    #[test]
    fn idle_by_default() {
        let t = ToolTimer::new(FakeClock::new());
        assert!(!t.is_active());
        assert_eq!(t.kind(), None);
        assert_eq!(t.remaining(), None);
    }

    #[test]
    fn countdown_counts_down_then_expires() {
        let clock = FakeClock::new();
        let mut t = ToolTimer::new(clock.clone());
        t.begin(ToolKind::Countdown, secs(60));
        assert_eq!(t.kind(), Some(ToolKind::Countdown));
        assert_eq!(t.remaining(), secs(60));
        clock.advance(45);
        assert_eq!(t.remaining(), secs(15));
        assert!(t.is_active());
        clock.advance(15);
        assert!(!t.is_active());
        assert_eq!(t.kind(), None);
        assert_eq!(t.remaining(), None);
    }

    #[test]
    fn expiry_is_reported_once() {
        let clock = FakeClock::new();
        let mut t = ToolTimer::new(clock.clone());
        t.begin(ToolKind::SoundDetector, secs(300));
        assert_eq!(t.poll_expired(), None);
        clock.advance(301);
        assert_eq!(t.poll_expired(), Some(ToolKind::SoundDetector));
        assert_eq!(t.poll_expired(), None);
    }

    #[test]
    fn scoreboard_has_no_timer_and_never_expires() {
        let clock = FakeClock::new();
        let mut t = ToolTimer::new(clock.clone());
        t.begin(ToolKind::Scoreboard, None);
        clock.advance(10 * 24 * 3600);
        assert_eq!(t.kind(), Some(ToolKind::Scoreboard));
        assert_eq!(t.remaining(), None);
        assert_eq!(t.poll_expired(), None);
    }

    #[test]
    fn end_stops_and_is_not_an_expiry() {
        let mut t = ToolTimer::new(FakeClock::new());
        t.begin(ToolKind::Countdown, secs(60));
        assert!(t.end());
        assert!(!t.is_active());
        assert_eq!(t.poll_expired(), None);
        assert!(!t.end());
    }

    #[test]
    fn stop_then_immediately_start() {
        let clock = FakeClock::new();
        let mut t = ToolTimer::new(clock.clone());
        t.begin(ToolKind::Countdown, secs(10));
        clock.advance(3);
        t.end();
        t.begin(ToolKind::SoundDetector, secs(300));
        assert_eq!(t.kind(), Some(ToolKind::SoundDetector));
        assert_eq!(t.remaining(), secs(300));
        // The first tool's deadline must not leak into the second.
        clock.advance(8);
        assert!(t.is_active());
    }

    #[test]
    fn begin_replaces_a_running_tool() {
        let mut t = ToolTimer::new(FakeClock::new());
        t.begin(ToolKind::Scoreboard, None);
        t.begin(ToolKind::Countdown, secs(5));
        assert_eq!(t.kind(), Some(ToolKind::Countdown));
        assert_eq!(t.remaining(), secs(5));
    }
}
