export type WeatherProviderFailureReason = 'timeout' | 'network' | 'invalid_response';

export type WeatherUnavailableReason = WeatherProviderFailureReason;

const PROVIDER_MESSAGES: Record<WeatherProviderFailureReason, string> = {
  timeout: 'Weather provider request timed out.',
  network: 'Weather provider request failed.',
  invalid_response: 'Weather provider returned an unusable response.',
};

export class WeatherProviderError extends Error {
  constructor(readonly reason: WeatherProviderFailureReason) {
    super(PROVIDER_MESSAGES[reason]);
    this.name = 'WeatherProviderError';
  }
}
