import { useCallback, useState, type Dispatch } from "react";
import { EMPTY_MEASURE, measureReducer, type MeasureAction, type MeasureState } from "./state";

/** Measuring state for one viewer; owned above the viewer so it survives a unit switch (which rebuilds the scene). */
export interface MeasureController {
  state: MeasureState;
  dispatch: Dispatch<MeasureAction>;
}

/** Measurements belong to the scan they were taken on: a different ``cloud`` starts empty. */
export function useMeasure(cloud: unknown): MeasureController {
  const [store, setStore] = useState({ key: cloud, state: EMPTY_MEASURE });
  const dispatch = useCallback(
    (a: MeasureAction) =>
      setStore((prev) => ({ key: cloud, state: measureReducer(prev.key === cloud ? prev.state : EMPTY_MEASURE, a) })),
    [cloud]
  );
  return { state: store.key === cloud ? store.state : EMPTY_MEASURE, dispatch };
}
