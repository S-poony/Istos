use super::World;

/// Trait for systems that operate on the ECS world.
pub trait System: Send + Sync {
    /// Returns the name of this system.
    fn name(&self) -> &'static str;

    /// Runs the system on the given world.
    fn run(&self, world: &mut World);
}
