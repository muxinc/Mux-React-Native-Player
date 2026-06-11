import AVKit
import ExpoModulesCore
import UIKit

public final class MuxAirPlayButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MuxAirPlayButton")

    View(MuxAirPlayButtonView.self) {
      Prop("tintColor") { (view: MuxAirPlayButtonView, color: UIColor?) in
        view.routePickerView.tintColor = color
      }

      Prop("activeTintColor") { (view: MuxAirPlayButtonView, color: UIColor?) in
        view.routePickerView.activeTintColor = color
      }
    }
  }
}

final class MuxAirPlayButtonView: ExpoView {
  let routePickerView = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    routePickerView.prioritizesVideoDevices = true
    routePickerView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(routePickerView)
    NSLayoutConstraint.activate([
      routePickerView.topAnchor.constraint(equalTo: topAnchor),
      routePickerView.bottomAnchor.constraint(equalTo: bottomAnchor),
      routePickerView.leadingAnchor.constraint(equalTo: leadingAnchor),
      routePickerView.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
  }
}
