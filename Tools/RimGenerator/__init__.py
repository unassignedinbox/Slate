"""Blender add-on package entry point for the Slate rim generator."""

from .rim_generator import register, unregister


if __name__ == "__main__":
    register()
