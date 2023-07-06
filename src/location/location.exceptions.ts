import { ExpectedExceptionMap } from '../app.interface';
import { HttpStatus } from '@nestjs/common';
import { differenceInCalendarDays, parse } from 'date-fns';

import { LocationRating } from '../entities/location-rating.entity';
import { MobileCheckIn } from '../entities/mobile-check-in.entity';

export const LocationExceptions: ExpectedExceptionMap = {
  locationNotFound: {
    message: 'Error: Location not found.',
    httpStatus: HttpStatus.NOT_FOUND,
    failCondition: location => !location,
    i18n: { 'es-PR': 'Ubicación no encontrada.' },
  },
  invalidStartingLatLong: {
    message:
      'Starting coordinates for sorting nearest locations are incomplete.',
    httpStatus: HttpStatus.BAD_REQUEST,
    failCondition: ({ startFromLong, startFromLat }) =>
      // XOR operator: startingLongLat param is optional but if present, both must be provided.
      startFromLat ? !startFromLong : startFromLong,
    i18n: {
      'es-PR':
        'Las coordenadas de inicio para la clasificación de las ubicaciones más cercanas están incompletas.',
    },
  },
  addReviewSpam: {
    message: 'You can only leave 1 review per listing every 30 days.',
    httpStatus: HttpStatus.BAD_REQUEST,
    failCondition: recentCount => recentCount > 0,
    i18n: { 'es-PR': 'Solo puedes dejar 1 opinión por listado cada 30 días.' },
  },
  invalidTimeRange: {
    message: 'Invalid time range.',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18n: { 'es-PR': 'Rango de tiempo no válido.' },
  },
  invalidTime: {
    message: 'Invalid time.',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18n: { 'es-PR': 'Tiempo inválido' },
  },
  reviewNotFound: {
    message: 'Review not found.',
    httpStatus: HttpStatus.NOT_FOUND,
    failCondition: (review: LocationRating) => !review || !review.id,
    i18n: { 'es-PR': 'Revisión no encontrada.' },
  },
  invalidCoordinates: {
    message: 'Invalid coordinates.',
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    failCondition: (longLat: string) => {
      const coordinatesPattern = /^\((.*),(.*)\)$/;
      const matches = longLat.match(coordinatesPattern);
      if (!matches) {
        return true;
      }

      const [, long, lat] = matches;
      const validLat = -90 <= +lat && +lat <= 90;
      const validLong = -180 <= +long && +long <= 180;
      return !validLat || !validLong;
    },
    i18n: { 'es-PR': 'Coordenadas inválidas' },
  },
  nearestLocationNotFound: {
    message: 'No nearby location.',
    httpStatus: HttpStatus.NOT_FOUND,
    failCondition: location => !location,
    i18n: { 'es-PR': 'No hay ubicaciones cercanas.' },
  },
  longLatRequired: {
    message: 'Please provide your starting location.',
    httpStatus: HttpStatus.BAD_REQUEST,
    failCondition: ({ startFromLong, startFromLat }) => {
      return !startFromLong || !startFromLat;
    },
    i18n: { 'es-PR': 'Proporcione su ubicación inicial.' },
  },
  checkinRestricted: {
    message: 'You have already checked in today.',
    httpStatus: HttpStatus.CONFLICT,
    failCondition: (latestCheckin: MobileCheckIn) => {
      return (
        !!latestCheckin &&
        !differenceInCalendarDays(
          parse(
            new Date().toLocaleString('en-US', {
              timeZone: latestCheckin.location.timezone,
            }),
          ),
          parse(
            new Date(latestCheckin.modified).toLocaleString('en-US', {
              timeZone: latestCheckin.location.timezone,
            }),
          ),
        )
      );
    },
    i18n: { 'es-PR': 'Ya te has registrado hoy.' },
  },
  mobileNumberRequired: {
    message: 'Mobile number is required.',
    httpStatus: HttpStatus.BAD_REQUEST,
    failCondition: (mobileNumber: string) => !mobileNumber,
    i18n: { 'es-PR': 'Se requiere número de móvil.' },
  },
};
