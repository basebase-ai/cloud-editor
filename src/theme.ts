"use client";

import { createTheme } from "@mantine/core";

export const theme = createTheme({
  /** Primary color scheme - using a modern blue/purple gradient */
  primaryColor: "violet",

  /** Default radius for components */
  defaultRadius: "md",

  /** Font family - more modern font stack */
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

  /** Customize colors for better modern appearance */
  colors: {
    // Custom brand colors
    brand: [
      "#f0f0ff",
      "#e0e0ff",
      "#c7c7ff",
      "#a5a5ff",
      "#8888ff",
      "#6b6bff",
      "#5555ff",
      "#4444dd",
      "#3333bb",
      "#222299",
    ],
    // Logo purple color - centralized definition
    logoPurple: [
      "#f3f0ff",
      "#e5d3ff",
      "#d0bfff",
      "#b197fc",
      "#9775fa",
      "#845ef7",
      "#7950f2",
      "#7048e8",
      "#6741d9",
      "#5f3dc4",
    ],
    // Better grays for modern UI
    gray: [
      "#fafafa",
      "#f5f5f5",
      "#e5e5e5",
      "#d4d4d4",
      "#a3a3a3",
      "#737373",
      "#525252",
      "#404040",
      "#262626",
      "#171717",
    ],
  },

  /** Custom spacing and sizing */
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    xxl: "3rem",
  },

  /** Component-specific theme overrides */
  components: {
    Paper: {
      defaultProps: {
        shadow: "sm",
        radius: "lg",
      },
    },
    Button: {
      defaultProps: {
        variant: "filled",
        radius: "md",
      },
      styles: {
        root: {
          fontWeight: 600,
          transition: "all 0.2s ease",
          "&:hover": {
            transform: "translateY(-1px)",
          },
        },
      },
    },
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: { backgroundOpacity: 0.55, blur: 3 },
        radius: "lg",
      },
    },
    Card: {
      defaultProps: {
        shadow: "sm",
        radius: "lg",
        withBorder: true,
      },
      styles: {
        root: {
          transition: "all 0.2s ease",
          "&:hover": {
            shadow: "md",
            transform: "translateY(-2px)",
          },
        },
      },
    },
    Title: {
      styles: {
        root: {
          fontWeight: 700,
          letterSpacing: "-0.02em",
        },
      },
    },
    Text: {
      styles: {
        root: {
          lineHeight: 1.6,
        },
      },
    },
  },

  /** Custom breakpoints for responsive design */
  breakpoints: {
    xs: "30em",
    sm: "48em",
    md: "64em",
    lg: "74em",
    xl: "90em",
  },
});
