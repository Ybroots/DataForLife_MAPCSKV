import { describe, expect, it } from 'vitest';
import { speechRecognitionCtor } from '../src/components/IncidentDraftAssistant';
import { imageLabelText, minutesLabel } from '../src/components/IncidentInsights';

describe('incident intelligence UI helpers', () => {
  it('finds the browser speech recogniser only when the browser has one', () => {
    class Fake {}
    expect(speechRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
    expect(speechRecognitionCtor({ SpeechRecognition: Fake })).toBe(Fake);
    expect(speechRecognitionCtor({})).toBeNull();
    expect(speechRecognitionCtor(undefined)).toBeNull();
  });

  it('labels the time between two reports', () => {
    expect(minutesLabel(45)).toBe('45 phút');
    expect(minutesLabel(60)).toBe('1 giờ');
    expect(minutesLabel(190)).toBe('3 giờ 10 phút');
  });

  it('has a Vietnamese label for every image label the API can return', () => {
    const apiLabels = ['fire_smoke', 'traffic_accident', 'crowd_gathering', 'fighting_or_weapon', 'flood_or_landslide',
      'property_damage', 'waste_or_pollution', 'document_or_screenshot', 'no_incident_visible', 'unclear'];
    expect(Object.keys(imageLabelText).sort()).toEqual(apiLabels.sort());
  });
});
