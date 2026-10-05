//! Byte transport behind the device, so command encoding can be tested
//! without Bluetooth.

use std::io;

use bluetooth_serial_port::{BtAddr, BtProtocol, BtSocket};
use std::io::Write;

use super::DeviceError;

pub trait Transport {
    /// Write all of `bytes` and flush.
    fn send(&mut self, bytes: &[u8]) -> io::Result<()>;
    /// Close the link. Must be idempotent.
    fn close(&mut self);
    fn is_open(&self) -> bool;
}

/// RFCOMM (serial port profile) link to a device.
pub struct BtTransport {
    socket: Option<BtSocket>,
}

impl BtTransport {
    pub fn connect(addr: BtAddr) -> Result<Self, DeviceError> {
        let mut socket =
            BtSocket::new(BtProtocol::RFCOMM).map_err(|e| DeviceError::Connect(e.to_string()))?;
        socket
            .connect(addr)
            .map_err(|e| DeviceError::Connect(e.to_string()))?;
        Ok(Self {
            socket: Some(socket),
        })
    }
}

impl Transport for BtTransport {
    fn send(&mut self, bytes: &[u8]) -> io::Result<()> {
        let socket = self
            .socket
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "not connected"))?;
        socket.write_all(bytes)?;
        socket.flush()
    }

    fn close(&mut self) {
        // BtSocket closes its descriptor when dropped.
        self.socket = None;
    }

    fn is_open(&self) -> bool {
        self.socket.is_some()
    }
}

#[cfg(test)]
pub mod mock {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    pub struct Log {
        pub packets: Vec<Vec<u8>>,
        pub closes: usize,
    }

    /// Records every packet and close; share `log` to inspect after a drop.
    pub struct MockTransport {
        pub log: Arc<Mutex<Log>>,
        open: bool,
    }

    impl MockTransport {
        pub fn new() -> (Self, Arc<Mutex<Log>>) {
            let log = Arc::new(Mutex::new(Log::default()));
            (
                Self {
                    log: log.clone(),
                    open: true,
                },
                log,
            )
        }
    }

    impl Transport for MockTransport {
        fn send(&mut self, bytes: &[u8]) -> io::Result<()> {
            if !self.open {
                return Err(io::Error::new(io::ErrorKind::NotConnected, "not connected"));
            }
            self.log.lock().unwrap().packets.push(bytes.to_vec());
            Ok(())
        }

        fn close(&mut self) {
            if self.open {
                self.open = false;
                self.log.lock().unwrap().closes += 1;
            }
        }

        fn is_open(&self) -> bool {
            self.open
        }
    }
}
