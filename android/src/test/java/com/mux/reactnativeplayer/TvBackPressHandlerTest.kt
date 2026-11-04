package com.mux.reactnativeplayer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvBackPressHandlerTest {
  @Test
  fun hidingControlsConsumesBothEdgesThenNextPressNavigates() {
    val handler = TvBackPressHandler()
    assertTrue(handler.onDown(0, controlsVisible = true))
    assertTrue(handler.onUp())
    assertFalse(handler.onDown(0, controlsVisible = false))
    assertFalse(handler.onUp())
  }

  @Test
  fun heldBackDoesNotEscapeAfterControlsHide() {
    val handler = TvBackPressHandler()
    assertTrue(handler.onDown(0, controlsVisible = true))
    assertTrue(handler.onDown(1, controlsVisible = false))
    assertTrue(handler.onDown(2, controlsVisible = false))
    assertTrue(handler.onUp())
  }

  @Test
  fun controlsAppearingDuringHostBackDoNotStealThePress() {
    val handler = TvBackPressHandler()
    assertFalse(handler.onDown(0, controlsVisible = false))
    assertFalse(handler.onDown(1, controlsVisible = true))
    assertFalse(handler.onUp())
  }

  @Test
  fun releaseOrFocusLossClearsOwnership() {
    val handler = TvBackPressHandler()
    assertTrue(handler.onDown(0, controlsVisible = true))
    handler.reset()
    assertFalse(handler.onUp())
    assertFalse(handler.onDown(1, controlsVisible = false))
  }

  @Test
  fun unpairedUpAndFreshDownCannotReuseAnEarlierPress() {
    val handler = TvBackPressHandler()
    assertFalse(handler.onUp())
    assertTrue(handler.onDown(0, controlsVisible = true))
    assertFalse(handler.onDown(0, controlsVisible = false))
    assertFalse(handler.onUp())
  }
}
