//! Embeds every `src/database/migrations/NNNN_name.sql` file into the binary.
//!
//! Adding a migration is a one-file change: drop a new numbered `.sql` file in
//! that directory. This script (kept under `src/` so the Dockerfile's
//! `COPY src` picks it up) generates the registry, so no shared list needs editing.

use std::path::PathBuf;
use std::{env, fs};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dir = manifest.join("src/database/migrations");
    println!("cargo:rerun-if-changed=src/database/migrations");

    let mut found: Vec<(u32, String, PathBuf)> = Vec::new();
    for entry in fs::read_dir(&dir).expect("cannot read src/database/migrations") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("sql") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let (num, name) = stem
            .split_once('_')
            .unwrap_or_else(|| panic!("migration '{stem}.sql' must be named NNNN_name.sql"));
        let version: u32 = num
            .parse()
            .unwrap_or_else(|_| panic!("migration '{stem}.sql' must start with a number"));
        found.push((version, name.to_string(), path));
    }
    found.sort();
    for pair in found.windows(2) {
        assert!(
            pair[0].0 != pair[1].0,
            "two migrations share version {}: {} and {}. Renumber one of them.",
            pair[0].0,
            pair[0].2.display(),
            pair[1].2.display()
        );
    }

    let mut out = String::from("pub static MIGRATIONS: &[Migration] = &[\n");
    for (version, name, path) in &found {
        out.push_str(&format!(
            "    Migration {{ version: {version}, name: {name:?}, sql: include_str!({:?}) }},\n",
            path.display().to_string()
        ));
    }
    out.push_str("];\n");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("migrations_list.rs"),
        out,
    )
    .unwrap();
}
