package com.mux.reactnativeplayer

/** Own the entire Back press, so hiding controls on DOWN cannot navigate on UP. */
internal class TvBackPressHandler {
  private var consumedDown = false

  fun onDown(repeatCount: Int, controlsVisible: Boolean): Boolean {
    if (repeatCount == 0) consumedDown = controlsVisible
    return consumedDown
  }

  fun onUp(): Boolean {
    val consumed = consumedDown
    reset()
    return consumed
  }

  fun reset() {
    consumedDown = false
  }
}
