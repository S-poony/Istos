use serde::{Deserialize, Serialize};
use std::any::Any;
use std::collections::HashMap;

use super::EntityId;

/// The type identifier for a component.
// pub type ComponentType = String;

/// Trait that all components must implement.
pub trait Component: Any + Send + Sync {
    /// Returns the component type name.
    fn component_type(&self) -> &str;

    /// Returns the component settings as a JSON Value.
    fn settings(&self) -> serde_json::Value;

    /// Updates the component settings from a JSON Value.
    fn update_settings(&mut self, settings: serde_json::Value);

    /// Allows downcasting to Any.
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

/// A boxed component.
pub type ComponentBox = Box<dyn Component>;

/// Registry of all known component types.
#[derive(Default)]
pub struct ComponentRegistry {
    // Stores component type names for lookup
    types: Vec<&'static str>,
}

impl ComponentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, component_type: &'static str) {
        if !self.types.contains(&component_type) {
            self.types.push(component_type);
        }
    }

    pub fn is_registered(&self, component_type: &'static str) -> bool {
        self.types.contains(&component_type)
    }

    pub fn all_types(&self) -> &[&'static str] {
        &self.types
    }
}

// ---------------------------------------------------------------------------
// Built-in components
// ---------------------------------------------------------------------------

/// Settings for the renderFile component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderFileSettings {
    /// Optional target path to render (None = render self).
    pub target_path: Option<String>,
    /// Scale factor for rendering.
    pub scale: f64,
    /// Position offset.
    pub position: Position,
}

impl Default for RenderFileSettings {
    fn default() -> Self {
        Self {
            target_path: None,
            scale: 1.0,
            position: Position { x: 0.0, y: 0.0 },
        }
    }
}

/// Renders a file entity.
pub struct RenderFile {
    pub settings: RenderFileSettings,
}

impl RenderFile {
    pub const TYPE: &str = "renderFile";

    pub fn new() -> Self {
        Self {
            settings: RenderFileSettings::default(),
        }
    }
}

impl Component for RenderFile {
    fn component_type(&self) -> &str {
        Self::TYPE
    }

    fn settings(&self) -> serde_json::Value {
        serde_json::to_value(&self.settings).unwrap_or_default()
    }

    fn update_settings(&mut self, settings: serde_json::Value) {
        if let Ok(s) = serde_json::from_value(settings) {
            self.settings = s;
        }
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// Settings for the grid component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridSettings {
    /// Number of columns in the grid.
    pub columns: u32,
    /// Gap between grid items in pixels.
    pub gap: f64,
    /// Whether items can be dragged.
    pub draggable: bool,
}

impl Default for GridSettings {
    fn default() -> Self {
        Self {
            columns: 4,
            gap: 8.0,
            draggable: false,
        }
    }
}

/// Arranges sub-entities in a grid layout.
pub struct Grid {
    pub settings: GridSettings,
}

impl Grid {
    pub const TYPE: &str = "grid";

    pub fn new() -> Self {
        Self {
            settings: GridSettings::default(),
        }
    }
}

impl Component for Grid {
    fn component_type(&self) -> &str {
        Self::TYPE
    }

    fn settings(&self) -> serde_json::Value {
        serde_json::to_value(&self.settings).unwrap_or_default()
    }

    fn update_settings(&mut self, settings: serde_json::Value) {
        if let Ok(s) = serde_json::from_value(settings) {
            self.settings = s;
        }
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// 2D position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// Helper to create a component from type name and settings.
pub fn create_component(
    component_type: &str,
    settings: serde_json::Value,
) -> Option<ComponentBox> {
    let mut component: ComponentBox = match component_type {
        "renderFile" => Box::new(RenderFile::new()),
        "grid" => Box::new(Grid::new()),
        _ => return None,
    };
    component.update_settings(settings);
    Some(component)
}
