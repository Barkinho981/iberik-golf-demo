export interface Course {
  id: number;
  slug: string;
  name: string;
  holes: number;
  par: number;
  buggiesCount: number;
  trolleysCount: number;
  roundDurationMinutes: number;
  location: string;
  hotelName: string;
}

export interface UserProfile {
  id: number;
  uid: string | null;
  email: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  licencia: string;
  poblacion: string;
  role: 'admin' | 'reception' | 'player' | string;
  createdAt?: string;
}

export interface TeeTimeSlotAvailability {
  slotTime: string;
  bookedPlayers: number;
  remainingPlayers: number;
  availableBuggies: number;
  availableTrolleys: number;
}

export interface CourseAvailabilityResponse {
  course: Course;
  date: string;
  fleetTotals: {
    buggiesOperational: number;
    buggiesTotal: number;
    trolleysOperational: number;
    trolleysTotal: number;
  };
  slots: TeeTimeSlotAvailability[];
}

export interface AcademySlotAvailability {
  slotTime: string;
  endTime: string;
  session: 'morning' | 'afternoon';
  bookedStudents: number;
  remainingSpots: number;
  maxStudents: number;
}

export interface AcademyAvailabilityResponse {
  course: Course;
  instructor: string;
  date: string;
  isWednesday: boolean;
  slots: AcademySlotAvailability[];
}

export interface TeeTimeReservationRow {
  id: number;
  date: string;
  slotTime: string;
  playersCount: number;
  playerNames: string;
  buggiesRequested: number;
  trolleysRequested: number;
  paymentMethod: string;
  mewsStatus: string;
  mewsReference: string;
  notes: string;
  status: string;
  createdAt: string;
  courseId: number;
  courseSlug: string;
  courseName: string;
  courseHoles: number;
  userId: number;
  userEmail: string;
  userNombre: string;
  userApellidos: string;
  userLicencia: string;
  userTelefono: string;
}

export interface AcademyBookingRow {
  id: number;
  date: string;
  slotTime: string;
  instructor: string;
  studentsCount: number;
  level: string;
  mewsStatus: string;
  status: string;
  notes: string;
  createdAt: string;
  courseName: string;
  userId: number;
  userEmail: string;
  userNombre: string;
  userApellidos: string;
  userLicencia: string;
  userTelefono: string;
}

export interface VehicleReservationItem {
  id: number;
  vehicleId: number;
  courseId: number;
  userId: number;
  teeTimeReservationId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  mewsStatus: string;
  status: string;
  notes: string;
  userNombre: string;
  userApellidos: string;
  userEmail: string;
}

export interface FleetVehicleItem {
  id: number;
  courseId: number;
  courseSlug: string;
  courseName: string;
  code: string;
  type: 'buggy' | 'electric_trolley' | string;
  label: string;
  status: 'operational' | 'maintenance' | string;
  notes: string;
  busyAtSelectedTime: boolean;
  reservationsToday: VehicleReservationItem[];
  occupiedWindows?: { startTime: string; endTime: string }[];
}

export interface FleetOverviewResponse {
  date: string;
  checkStartTime: string;
  courses: Course[];
  vehicles: FleetVehicleItem[];
}
