import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { ROUTING_VEHICLE_TYPES } from '../../../domain/route-planner/route-planner.types';

export class RouteLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export class RoutingVehicleDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsIn(ROUTING_VEHICLE_TYPES)
  type!: (typeof ROUTING_VEHICLE_TYPES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(9)
  axles!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  fuelType!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  consumptionKmPerLiter!: number;
}

export class CalculateRouteDto {
  @ValidateNested()
  @Type(() => RouteLocationDto)
  origin!: RouteLocationDto;

  @ValidateNested()
  @Type(() => RouteLocationDto)
  destination!: RouteLocationDto;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RouteLocationDto)
  waypoints: RouteLocationDto[] = [];

  @IsBoolean()
  roundTrip = false;

  @ValidateNested()
  @Type(() => RoutingVehicleDto)
  vehicle!: RoutingVehicleDto;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  fuelPricePerLiter!: number;

  @IsDateString({ strict: true })
  travelDate!: string;
}
